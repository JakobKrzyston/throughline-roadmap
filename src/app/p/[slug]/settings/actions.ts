"use server";
/** Server action behind the settings page. Exports connectRepository and its state type. */
import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { after } from "next/server";
import { z } from "zod";

import {
  getGitHubAdapter,
  isGitHubConfigured,
  isOwnerAllowed,
} from "@/adapters/github";
import { getDb } from "@/db/client";
import { projects, repositories } from "@/db/schema";
import { runQueuedJobs } from "@/jobs";
import { enqueue } from "@/jobs/queue";

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
