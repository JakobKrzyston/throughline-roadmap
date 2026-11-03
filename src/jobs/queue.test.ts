/** Tests for the job queue against an in-memory database. */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { jobs } from "@/db/schema";
import { createTestDb } from "@/db/test-db";

import { enqueue, MAX_ATTEMPTS, runJobs } from "./queue";

type TestDb = Awaited<ReturnType<typeof createTestDb>>;

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

async function job(id: string): Promise<typeof jobs.$inferSelect> {
  const [row] = await db.select().from(jobs).where(eq(jobs.id, id));
  return row;
}

describe("runJobs", () => {
  it("runs a queued job with its payload and marks it done", async () => {
    const id = await enqueue(db, "backfill", { repositoryId: "r1" });
    const backfill = vi.fn(async () => {});

    expect(await runJobs(db, { backfill })).toEqual({ done: 1, failed: 0 });
    expect(backfill).toHaveBeenCalledWith({ repositoryId: "r1" });
    expect(await job(id)).toMatchObject({ status: "done", attempts: 1 });
  });

  it("leaves job types without a handler queued", async () => {
    const id = await enqueue(db, "reconcile", {
      workItemId: "w",
      requirementId: "r",
    });
    expect(await runJobs(db, { backfill: async () => {} })).toEqual({
      done: 0,
      failed: 0,
    });
    expect(await job(id)).toMatchObject({ status: "queued", attempts: 0 });
  });

  it("retries a failing job later, then marks it failed", async () => {
    const id = await enqueue(db, "backfill", { repositoryId: "r1" });
    const backfill = vi.fn(async () => {
      throw new Error("GitHub is down");
    });

    await runJobs(db, { backfill });
    const retry = await job(id);
    expect(retry).toMatchObject({
      status: "queued",
      attempts: 1,
      lastError: "GitHub is down",
    });
    expect(retry.runAfter.getTime()).toBeGreaterThan(Date.now());

    // Not due yet, so a second run does nothing.
    await runJobs(db, { backfill });
    expect(backfill).toHaveBeenCalledTimes(1);

    for (let attempt = 2; attempt <= MAX_ATTEMPTS; attempt++) {
      await db
        .update(jobs)
        .set({ runAfter: new Date(0) })
        .where(eq(jobs.id, id));
      await runJobs(db, { backfill });
    }
    expect(await job(id)).toMatchObject({
      status: "failed",
      attempts: MAX_ATTEMPTS,
    });
    expect(backfill).toHaveBeenCalledTimes(MAX_ATTEMPTS);
  });

  it("runs a job again if it was cut off while running", async () => {
    const id = await enqueue(db, "backfill", { repositoryId: "r1" });
    await db
      .update(jobs)
      .set({ status: "running", attempts: 1 })
      .where(eq(jobs.id, id));
    // updatedAt is set on every update, so backdate it directly.
    await db.execute(`update jobs set updated_at = now() - interval '1 hour'`);

    const backfill = vi.fn(async () => {});
    await runJobs(db, { backfill });
    expect(backfill).toHaveBeenCalledOnce();
    expect(await job(id)).toMatchObject({ status: "done", attempts: 2 });
  });

  it("does not touch a job that is running now", async () => {
    const id = await enqueue(db, "backfill", { repositoryId: "r1" });
    await db
      .update(jobs)
      .set({ status: "running", attempts: 1 })
      .where(eq(jobs.id, id));
    const backfill = vi.fn(async () => {});
    await runJobs(db, { backfill });
    expect(backfill).not.toHaveBeenCalled();
  });

  it("stops after the limit", async () => {
    for (let i = 0; i < 3; i++)
      await enqueue(db, "backfill", { repositoryId: `r${i}` });
    expect(await runJobs(db, { backfill: async () => {} }, 2)).toEqual({
      done: 2,
      failed: 0,
    });
  });
});
