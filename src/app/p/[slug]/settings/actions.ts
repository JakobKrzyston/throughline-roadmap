"use server";
/** Server actions behind the settings page. Exports connectRepository, connectLinearTeam, saveDigest, stopDigest and their state types. */
import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { after } from "next/server";
import { z } from "zod";

import {
  getGitHubAdapter,
  isGitHubConfigured,
  isOwnerAllowed,
} from "@/adapters/github";
import { isTeamAllowed, linearAdapterFor } from "@/adapters/linear";
import { LinearError } from "@/adapters/linear/source";
import { postToSlack, slackWebhookUrlSchema } from "@/adapters/slack";
import { loadDigest } from "@/core/digest";
import {
  collidesWithRequirementKeys,
  REQUIREMENT_KEY_PREFIX,
} from "@/core/references";
import { getDb } from "@/db/client";
import { projects, repositories } from "@/db/schema";
import { runQueuedJobs } from "@/jobs";
import { enqueue } from "@/jobs/queue";
import { isPublicDeployment } from "@/lib/public-deployment";
import { appOrigin } from "@/lib/app-origin";

export type DigestState =
  | { status: "idle" }
  | { status: "error"; message: string; webhookUrl: string }
  | { status: "success"; message: string };

export type ConnectState =
  | { status: "idle" }
  | { status: "error"; message: string; repository: string }
  | { status: "success"; message: string };

const repositorySchema = z
  .string({ error: "Enter a repository." })
  .trim()
  // Accept a pasted GitHub URL as well as owner/name.
  .transform((value) =>
    value.replace(/^https?:\/\/github\.com\//i, "").replace(/(\.git)?\/?$/, ""),
  )
  .pipe(
    z
      .string()
      .regex(
        /^[\w.-]+\/[\w.-]+$/,
        "Enter the repository as owner/name, for example acme/analytics.",
      ),
  );

/**
 * Connect a GitHub repository to a project and start importing its issues and pull requests.
 *
 * Args:
 *   slug: The project's slug, bound by the page.
 *   _previous: The form's previous state (unused; required by useActionState).
 *   formData: Form fields; `repository` holds `owner/name`.
 *
 * Returns:
 *   A success message, or an error message to show.
 */
export async function connectRepository(
  slug: string,
  _previous: ConnectState,
  formData: FormData,
): Promise<ConnectState> {
  const raw = formData.get("repository");
  const fail = (message: string): ConnectState => ({
    status: "error",
    message,
    repository: typeof raw === "string" ? raw : "",
  });
  const notAllowed = (name: string): ConnectState =>
    fail(
      `This server only connects repositories from approved accounts, and ${name.split("/")[0]} is not one of them.`,
    );

  if (isPublicDeployment()) {
    return fail("Repositories are connected by the site owner on this server.");
  }
  if (!isGitHubConfigured()) {
    return fail("GitHub is not set up on this server yet.");
  }
  const fullName = repositorySchema.safeParse(raw);
  if (!fullName.success) return fail(fullName.error.issues[0].message);
  // Checked before the lookup so the answer reveals nothing about other owners' repositories.
  if (!isOwnerAllowed(fullName.data)) return notAllowed(fullName.data);

  const db = getDb();
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, slug));
  if (!project) return fail("Project not found.");

  let repository;
  try {
    repository = await getGitHubAdapter().findRepository(fullName.data);
  } catch (error) {
    console.error("Repository lookup failed:", error);
    return fail("Could not reach GitHub. Please try again.");
  }
  if (!repository) {
    return fail(
      `Throughline cannot see ${fullName.data}. Install the GitHub App on it first, then try again.`,
    );
  }
  // GitHub follows renames and transfers, so the repository found may belong to another owner.
  if (!isOwnerAllowed(repository.fullName)) {
    return notAllowed(repository.fullName);
  }

  const connected = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(repositories)
      .values({
        projectId: project.id,
        source: "github",
        externalId: repository.externalId,
        fullName: repository.fullName,
      })
      .onConflictDoNothing()
      .returning({ id: repositories.id });
    if (row) {
      await enqueue(tx, project.id, "backfill", { repositoryId: row.id });
    }
    return Boolean(row);
  });
  if (!connected) return fail(`${repository.fullName} is already connected.`);

  after(runQueuedJobs);
  refresh();
  return {
    status: "success",
    message: `Connected ${repository.fullName}. Importing its open issues and recently merged pull requests now.`,
  };
}

const teamKeySchema = z
  .string({ error: "Enter a team key." })
  .trim()
  .regex(
    /^[A-Za-z0-9]{1,7}$/,
    "Enter the team's key, the letters before the number in its issue ids, for example ENG.",
  );

/**
 * Connect a Linear team to a project and start importing its issues.
 *
 * Demo projects connect the sample team, so they never call Linear. A real team must be listed in
 * LINEAR_ALLOWED_TEAMS. Connecting also records whether the workspace has a team keyed TL, whose
 * issue ids look like requirement keys; if so, references in the team's issues are ignored.
 * Throughline only reads from Linear.
 *
 * Args:
 *   slug: The project's slug, bound by the page.
 *   _previous: The form's previous state (unused; required by useActionState).
 *   formData: Form fields; `repository` holds the team key, e.g. `ENG`.
 *
 * Returns:
 *   A success message, or an error message to show.
 */
export async function connectLinearTeam(
  slug: string,
  _previous: ConnectState,
  formData: FormData,
): Promise<ConnectState> {
  const raw = formData.get("repository");
  const fail = (message: string): ConnectState => ({
    status: "error",
    message,
    repository: typeof raw === "string" ? raw : "",
  });

  const notAllowed = (key: string): ConnectState =>
    fail(
      `This server only connects approved Linear teams, and ${key.toUpperCase()} is not one of them.`,
    );

  if (isPublicDeployment()) {
    return fail("Linear teams are connected by the site owner on this server.");
  }
  const teamKey = teamKeySchema.safeParse(raw);
  if (!teamKey.success) return fail(teamKey.error.issues[0].message);

  const db = getDb();
  const [project] = await db
    .select({ id: projects.id, isDemo: projects.isDemo })
    .from(projects)
    .where(eq(projects.slug, slug));
  if (!project) return fail("Project not found.");
  const adapter = linearAdapterFor(project);
  if (!adapter) return fail("Linear is not set up on this server yet.");
  // The sample team needs no approval. Checked before the lookup so the answer reveals nothing
  // about other teams.
  if (!project.isDemo && !isTeamAllowed(teamKey.data)) {
    return notAllowed(teamKey.data);
  }

  let team;
  let referencesIgnored;
  try {
    team = await adapter.findRepository(teamKey.data);
    referencesIgnored =
      team !== null &&
      (collidesWithRequirementKeys(team.fullName) ||
        (await adapter.findRepository(REQUIREMENT_KEY_PREFIX)) !== null);
  } catch (error) {
    console.error("Linear team lookup failed:", error);
    return fail(
      error instanceof LinearError
        ? error.message
        : "Could not reach Linear. Please try again.",
    );
  }
  if (!team) {
    return fail(
      `Throughline cannot see a Linear team with the key ${teamKey.data.toUpperCase()}. Check the key, and that the API key's owner can see the team.`,
    );
  }

  const connected = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(repositories)
      .values({
        projectId: project.id,
        source: "linear",
        externalId: team.externalId,
        fullName: team.fullName,
        referencesIgnored,
      })
      .onConflictDoNothing()
      .returning({ id: repositories.id });
    if (row) {
      await enqueue(tx, project.id, "backfill", { repositoryId: row.id });
    }
    return Boolean(row);
  });
  if (!connected) {
    return fail(`The Linear team ${team.fullName} is already connected.`);
  }

  after(runQueuedJobs);
  refresh();
  return {
    status: "success",
    message: `Connected the Linear team ${team.fullName}. Importing its open issues and the issues completed in the last 90 days now.`,
  };
}

/**
 * Start the weekly digest: send this week's digest to a Slack webhook now, and save the webhook if
 * Slack accepts it, so a mistyped URL is caught here rather than on Monday.
 *
 * Args:
 *   slug: The project's slug, bound by the page.
 *   _previous: The form's previous state (unused; required by useActionState).
 *   formData: Form fields; `webhookUrl` holds the Slack incoming webhook URL.
 *
 * Returns:
 *   A success message, or an error message to show.
 */
export async function saveDigest(
  slug: string,
  _previous: DigestState,
  formData: FormData,
): Promise<DigestState> {
  const raw = formData.get("webhookUrl");
  const fail = (message: string): DigestState => ({
    status: "error",
    message,
    webhookUrl: typeof raw === "string" ? raw : "",
  });

  // A visitor's webhook would receive posts from this server until someone removed it.
  if (isPublicDeployment()) {
    return fail("Digests are set up by the site owner on this server.");
  }
  const webhookUrl = slackWebhookUrlSchema.safeParse(raw);
  if (!webhookUrl.success) return fail(webhookUrl.error.issues[0].message);

  const db = getDb();
  const [project] = await db
    .select({
      id: projects.id,
      name: projects.name,
      slug: projects.slug,
      digestSentAt: projects.digestSentAt,
    })
    .from(projects)
    .where(eq(projects.slug, slug));
  if (!project) return fail("Project not found.");

  try {
    const text = await loadDigest(db, project, await appOrigin());
    await postToSlack(webhookUrl.data, text);
  } catch (error) {
    console.error("Digest test send failed:", error);
    return fail(
      "Slack did not accept the digest. Check the webhook URL and try again.",
    );
  }
  // The weekly send is left as it was: this one only shows the channel is right.
  await db
    .update(projects)
    .set({ digestSlackWebhookUrl: webhookUrl.data })
    .where(eq(projects.id, project.id));

  refresh();
  return {
    status: "success",
    message:
      "Sent this week's digest to Slack. From now on it goes out every Monday morning.",
  };
}

/**
 * Stop the weekly digest and forget the Slack webhook.
 *
 * Args:
 *   slug: The project's slug, bound by the page.
 */
export async function stopDigest(slug: string): Promise<void> {
  if (isPublicDeployment()) return;
  await getDb()
    .update(projects)
    .set({ digestSlackWebhookUrl: null, digestSentAt: null })
    .where(eq(projects.slug, slug));
  refresh();
}
