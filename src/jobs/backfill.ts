/** The backfill job: imports a newly connected repository's open issues and recently merged PRs, a page per job. Exports runBackfill, backfillStatuses, BackfillStatus, BACKFILL_DAYS. */
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import type { SourceAdapter } from "@/adapters/source";
import { syncFeedback, syncWorkItem } from "@/core/work-items";
import type { Database } from "@/db/client";
import { jobs, repositories } from "@/db/schema";

import type { JobPayloads } from "./queue";

/** How far back merged pull requests are imported. */
export const BACKFILL_DAYS = 90;

/** Where a repository's import stands, as the settings page shows it. */
export type BackfillStatus =
  | { state: "importing" }
  | { state: "retrying"; error: string }
  | { state: "failed"; error: string }
  | { state: "done" };

/**
 * Import one page of a connected repository's open issues and the pull requests merged in the
 * last BACKFILL_DAYS days, and return the job for the next page.
 *
 * Each page is its own job, so every run does a bounded amount of work and a retry repeats only
 * the page that failed. Each item goes through syncWorkItem, so repeating a page creates no
 * duplicates. Explicit references are linked, but no reconciliation is queued: work that finished
 * before the repository was connected is history, not news, and reconciling all of it at once
 * would flood the review queue. Open feedback is imported and matched to outcomes, since what
 * customers are still asking for is news.
 *
 * Args:
 *   db: Database to write to.
 *   adapter: Source the repository lives in.
 *   payload: The backfill job's payload.
 *   now: Current time, for tests. Only the first page uses it to choose the cut-off date.
 *
 * Returns:
 *   The payload for the next page's job, or undefined when the import is complete.
 */
export async function runBackfill(
  db: Database,
  adapter: SourceAdapter,
  payload: JobPayloads["backfill"],
  now = new Date(),
): Promise<JobPayloads["backfill"] | undefined> {
  const [repository] = await db
    .select()
    .from(repositories)
    .where(eq(repositories.id, payload.repositoryId));
  // Disconnected before the job ran; nothing to import.
  if (!repository) return undefined;

  const mergedSince =
    payload.mergedSince ??
    new Date(now.getTime() - BACKFILL_DAYS * 86_400_000).toISOString();
  const { items, nextCursor } = await adapter.listBackfillPage(
    repository,
    new Date(mergedSince),
    payload.cursor ?? null,
  );
  for (const item of items) {
    if (item.kind === "feedback") {
      await syncFeedback(db, repository.projectId, item);
    } else {
      await syncWorkItem(db, repository.projectId, item, { reconcile: false });
    }
  }
  if (!nextCursor) return undefined;
  return { repositoryId: repository.id, mergedSince, cursor: nextCursor };
}

/**
 * Report how each repository's import is going, from its most recent backfill job.
 *
 * Args:
 *   db: Database holding the queue.
 *   repositoryIds: The repositories to report on.
 *
 * Returns:
 *   Each repository's status, keyed by id. Repositories with no backfill job are left out.
 */
export async function backfillStatuses(
  db: Database,
  repositoryIds: string[],
): Promise<Map<string, BackfillStatus>> {
  const repositoryId = sql<string>`${jobs.payload}->>'repositoryId'`;
  const rows = await db
    .select({ repositoryId, status: jobs.status, lastError: jobs.lastError })
    .from(jobs)
    .where(and(eq(jobs.type, "backfill"), inArray(repositoryId, repositoryIds)))
    .orderBy(desc(jobs.createdAt));

  const statuses = new Map<string, BackfillStatus>();
  for (const row of rows) {
    // Rows are newest first, and each page's job is created after the last one finishes.
    if (statuses.has(row.repositoryId)) continue;
    statuses.set(row.repositoryId, toStatus(row.status, row.lastError));
  }
  return statuses;
}

function toStatus(
  status: (typeof jobs.$inferSelect)["status"],
  lastError: string | null,
): BackfillStatus {
  if (status === "done") return { state: "done" };
  if (status === "failed") return { state: "failed", error: lastError ?? "" };
  if (status === "queued" && lastError) {
    return { state: "retrying", error: lastError };
  }
  return { state: "importing" };
}
