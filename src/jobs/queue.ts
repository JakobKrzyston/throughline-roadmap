/** A minimal Postgres-backed job queue. Exports enqueue, runJobs, JobPayloads, JobHandlers, MAX_ATTEMPTS. */
import { and, asc, eq, inArray, lt, lte, or } from "drizzle-orm";

import type { Database } from "@/db/client";
import { jobs } from "@/db/schema";

/** Every job type and the payload it carries. */
export type JobPayloads = {
  /**
   * Import one page of open issues and recently merged PRs from a newly connected repository.
   * The first job carries only the repository; each later page carries the cut-off date the
   * first one chose and the source's cursor.
   */
  backfill: { repositoryId: string; mergedSince?: string; cursor?: string };
  /** Compare a finished work item with one requirement it is linked to. */
  reconcile: { workItemId: string; requirementId: string };
  /** Suggest a requirement for a merged pull request that references none. */
  link_suggest: { workItemId: string };
};

export type JobType = keyof JobPayloads;

/**
 * Functions that run each job type. Types without a handler stay queued until one exists.
 *
 * A handler may return the payload of a follow-up job of the same type. It is queued in the same
 * transaction that marks this job done, so a job cut off before finishing never queues it twice.
 */
export type JobHandlers = {
  [T in JobType]?: (payload: JobPayloads[T]) => Promise<JobPayloads[T] | void>;
};

/** A job that has failed this many times is marked `failed` and not retried. */
export const MAX_ATTEMPTS = 3;

const RETRY_DELAY_MS = 60_000;
// A job still `running` after this long was cut off (for example by a serverless timeout) and is run again.
const STALE_AFTER_MS = 15 * 60_000;

/**
 * Add a job to the queue.
 *
 * Args:
 *   db: Database or transaction to write to. Inside a transaction, the job exists only if it commits.
 *   type: The job type.
 *   payload: Its payload.
 *
 * Returns:
 *   The new job's id.
 */
export async function enqueue<T extends JobType>(
  db: Pick<Database, "insert">,
  type: T,
  payload: JobPayloads[T],
): Promise<string> {
  const [job] = await db
    .insert(jobs)
    .values({ type, payload })
    .returning({ id: jobs.id });
  return job.id;
}

/**
 * Run due jobs one at a time until the queue is empty or `limit` jobs have run.
 *
 * A failed job is retried after a delay, up to MAX_ATTEMPTS attempts. Safe to call from several
 * places at once: each job is claimed by exactly one caller.
 *
 * Args:
 *   db: Database holding the queue.
 *   handlers: How to run each job type.
 *   limit: Most jobs to run in this call.
 *
 * Returns:
 *   How many jobs finished and how many failed in this call.
 */
export async function runJobs(
  db: Database,
  handlers: JobHandlers,
  limit = 20,
): Promise<{ done: number; failed: number }> {
  const summary = { done: 0, failed: 0 };
  const types = Object.keys(handlers) as JobType[];
  if (types.length === 0) return summary;

  for (let i = 0; i < limit; i++) {
    const job = await claimNextJob(db, types);
    if (!job) break;

    let error: unknown;
    let followUp: unknown;
    if (job.attempts > MAX_ATTEMPTS) {
      error = new Error("Stopped responding on its last attempt");
    } else {
      try {
        const handler = handlers[job.type as JobType] as (
          payload: unknown,
        ) => Promise<unknown>;
        followUp = await handler(job.payload);
      } catch (caught) {
        error = caught;
      }
    }

    if (error === undefined) {
      await db.transaction(async (tx) => {
        if (followUp) {
          await tx.insert(jobs).values({ type: job.type, payload: followUp });
        }
        await tx
          .update(jobs)
          .set({ status: "done" })
          .where(eq(jobs.id, job.id));
      });
      summary.done++;
      continue;
    }

    console.error(`Job ${job.id} (${job.type}) failed:`, error);
    const giveUp = job.attempts >= MAX_ATTEMPTS;
    await db
      .update(jobs)
      .set({
        status: giveUp ? "failed" : "queued",
        lastError: error instanceof Error ? error.message : String(error),
        runAfter: new Date(Date.now() + job.attempts * RETRY_DELAY_MS),
      })
      .where(eq(jobs.id, job.id));
    if (giveUp) summary.failed++;
  }
  return summary;
}

async function claimNextJob(
  db: Database,
  types: JobType[],
): Promise<typeof jobs.$inferSelect | null> {
  return db.transaction(async (tx) => {
    const now = new Date();
    // SKIP LOCKED lets concurrent runners each take a different job instead of waiting.
    const [job] = await tx
      .select()
      .from(jobs)
      .where(
        and(
          inArray(jobs.type, types),
          or(
            and(eq(jobs.status, "queued"), lte(jobs.runAfter, now)),
            and(
              eq(jobs.status, "running"),
              lt(jobs.updatedAt, new Date(now.getTime() - STALE_AFTER_MS)),
            ),
          ),
        ),
      )
      .orderBy(asc(jobs.runAfter))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!job) return null;

    const [claimed] = await tx
      .update(jobs)
      .set({ status: "running", attempts: job.attempts + 1 })
      .where(eq(jobs.id, job.id))
      .returning();
    return claimed;
  });
}
