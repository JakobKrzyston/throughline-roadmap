/** Runs the app's queued jobs with their real handlers. Exports runQueuedJobs. */
import { getGitHubAdapter } from "@/adapters/github";
import { getDb } from "@/db/client";

import { runBackfill } from "./backfill";
import { runJobs } from "./queue";

/**
 * Run due jobs against the app database.
 *
 * Reconcile jobs have no handler until the reconciliation agent exists (Stage 5), so they stay queued.
 *
 * Returns:
 *   How many jobs finished and how many failed.
 */
export async function runQueuedJobs(): Promise<{
  done: number;
  failed: number;
}> {
  const db = getDb();
  return runJobs(db, {
    backfill: ({ repositoryId }) =>
      runBackfill(db, getGitHubAdapter(), repositoryId),
  });
}
