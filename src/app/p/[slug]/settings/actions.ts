"use server";
/** Server actions behind the settings page. Exports connectRepository, saveDigest, sendDigest, stopDigest and their state types. */
import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { after } from "next/server";
import { z } from "zod";

import {
  getGitHubAdapter,
  isGitHubConfigured,
  isOwnerAllowed,
} from "@/adapters/github";
import { postToSlack, slackWebhookUrlSchema } from "@/adapters/slack";
import { loadDigest } from "@/core/digest";
import { sendDigestNow } from "@/core/digest-triggers";
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

export type SendState =
  { status: "idle" } | { status: "error" | "success"; message: string };

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
    if (row) await enqueue(tx, "backfill", { repositoryId: row.id });
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
 * Send this week's digest to the project's Slack channel now. The Monday send is unchanged.
 *
 * Args:
 *   slug: The project's slug, bound by the page.
 *
 * Returns:
 *   A success message, or an error message to show.
 */
export async function sendDigest(slug: string): Promise<SendState> {
  const fail = (message: string): SendState => ({ status: "error", message });
  if (isPublicDeployment()) {
    return fail("Digests are sent by the site owner on this server.");
  }
  try {
    const result = await sendDigestNow(getDb(), slug, {
      baseUrl: await appOrigin(),
      post: postToSlack,
    });
    if (result !== "sent") return fail("This project has no digest set up.");
  } catch (error) {
    console.error("Digest send failed:", error);
    return fail("Slack did not accept the digest. Please try again.");
  }
  return { status: "success", message: "Sent this week's digest to Slack." };
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
