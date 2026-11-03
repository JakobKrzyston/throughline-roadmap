/** The backfill job: imports a newly connected repository's open issues and recently merged PRs. Exports runBackfill, BACKFILL_DAYS. */
import { eq } from "drizzle-orm";

import type { SourceAdapter } from "@/adapters/source";
import { syncWorkItem } from "@/core/work-items";
import type { Database } from "@/db/client";
import { repositories } from "@/db/schema";

/** How far back merged pull requests are imported. */
export const BACKFILL_DAYS = 90;

/**
 * Import a connected repository's open issues and the pull requests merged in the last BACKFILL_DAYS days.
 *
 * Each item goes through syncWorkItem, so running a backfill twice creates no duplicates.
 *
 * Args:
 *   db: Database to write to.
 *   adapter: Source the repository lives in.
 *   repositoryId: Throughline's id for the connected repository.
 *   now: Current time, for tests.
 */
export async function runBackfill(
  db: Database,
  adapter: SourceAdapter,
  repositoryId: string,
  now = new Date(),
): Promise<void> {
  const [repository] = await db
    .select()
    .from(repositories)
    .where(eq(repositories.id, repositoryId));
  // Disconnected before the job ran; nothing to import.
  if (!repository) return;

  const mergedSince = new Date(now.getTime() - BACKFILL_DAYS * 86_400_000);
  const items = await adapter.listBackfill(repository.fullName, mergedSince);
  for (const item of items) {
    await syncWorkItem(db, repository.projectId, item);
  }
}
