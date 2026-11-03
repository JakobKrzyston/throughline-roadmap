/** Tests for the backfill job with a fake source adapter. */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SourceAdapter, SourceWorkItem } from "@/adapters/source";
import { applyProposal } from "@/core/proposals";
import {
  jobs,
  links,
  projects,
  proposals,
  repositories,
  workItems,
} from "@/db/schema";
import { createTestDb } from "@/db/test-db";

import { backfillStatuses, runBackfill } from "./backfill";
import { enqueue, MAX_ATTEMPTS, runJobs } from "./queue";

type TestDb = Awaited<ReturnType<typeof createTestDb>>;

let db: TestDb;
let projectId: string;
let repositoryId: string;

const issue: SourceWorkItem = {
  source: "github",
  externalId: "4242#7",
  kind: "issue",
  title: "Slow export",
  body: "",
  url: "https://github.com/acme/analytics/issues/7",
  state: "open",
  mergedAt: null,
  closedAt: null,
  updatedAt: new Date("2026-11-01"),
};

const adapter = {
  source: "github",
  findRepository: async () => null,
  listBackfillPage: vi.fn<SourceAdapter["listBackfillPage"]>(async () => ({
    items: [issue],
    nextCursor: null,
  })),
  listChangedFiles: async () => [],
} satisfies SourceAdapter;

beforeEach(async () => {
  db = await createTestDb();
  const [project] = await db
    .insert(projects)
    .values({ name: "Test", slug: "test" })
    .returning();
  projectId = project.id;
  [{ id: repositoryId }] = await db
    .insert(repositories)
    .values({
      projectId: project.id,
      source: "github",
      externalId: "4242",
      fullName: "acme/analytics",
    })
    .returning();
  // Back to the default page, dropping any implementation a test set.
  adapter.listBackfillPage.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("runBackfill", () => {
  it("asks for the first page with PRs merged in the last 90 days and stores what it gets", async () => {
    const next = await runBackfill(
      db,
      adapter,
      { repositoryId },
      new Date("2026-11-03T00:00:00Z"),
    );

    expect(adapter.listBackfillPage).toHaveBeenCalledWith(
      expect.objectContaining({
        externalId: "4242",
        fullName: "acme/analytics",
      }),
      new Date("2026-08-05T00:00:00Z"),
      null,
    );
    expect(await db.select().from(workItems)).toHaveLength(1);
    expect(next).toBeUndefined();
  });

  it("returns the next page's job, keeping the first page's cut-off date", async () => {
    adapter.listBackfillPage.mockResolvedValueOnce({
      items: [issue],
      nextCursor: "issues:3",
    });
    const next = await runBackfill(
      db,
      adapter,
      {
        repositoryId,
        mergedSince: "2026-08-05T00:00:00.000Z",
        cursor: "issues:2",
      },
      new Date("2026-12-25T00:00:00Z"),
    );

    expect(adapter.listBackfillPage).toHaveBeenCalledWith(
      expect.anything(),
      new Date("2026-08-05T00:00:00Z"),
      "issues:2",
    );
    expect(next).toEqual({
      repositoryId,
      mergedSince: "2026-08-05T00:00:00.000Z",
      cursor: "issues:3",
    });
  });

  it("links references in finished work without queueing reconciliation", async () => {
    const [proposal] = await db
      .insert(proposals)
      .values({
        projectId,
        source: "import",
        summary: "Roadmap",
        operations: [
          { type: "create_outcome", key: "OUT-1", title: "Export" },
          {
            type: "create_requirement",
            key: "TL-1",
            outcome_key: "OUT-1",
            title: "CSV",
          },
        ],
      })
      .returning();
    await applyProposal(db, proposal.id, "pm");
    adapter.listBackfillPage.mockResolvedValueOnce({
      items: [
        {
          ...issue,
          externalId: "4242#9",
          kind: "pull_request",
          body: "Implements TL-1",
          state: "merged",
          mergedAt: new Date("2026-10-01"),
        },
      ],
      nextCursor: null,
    });
    await runBackfill(db, adapter, { repositoryId });

    expect(await db.select().from(links)).toHaveLength(1);
    expect(
      await db.select().from(jobs).where(eq(jobs.type, "reconcile")),
    ).toEqual([]);
  });

  it("can run twice without duplicating work items", async () => {
    await runBackfill(db, adapter, { repositoryId });
    await runBackfill(db, adapter, { repositoryId });
    expect(await db.select().from(workItems)).toHaveLength(1);
  });

  it("does nothing for a repository that was disconnected", async () => {
    expect(
      await runBackfill(db, adapter, {
        repositoryId: "00000000-0000-0000-0000-000000000000",
      }),
    ).toBeUndefined();
    expect(adapter.listBackfillPage).not.toHaveBeenCalled();
  });
});

describe("backfill through the job queue", () => {
  const handlers = {
    backfill: (payload: { repositoryId: string }) =>
      runBackfill(db, adapter, payload),
  };
  const item = (number: number): SourceWorkItem => ({
    ...issue,
    externalId: `4242#${number}`,
  });

  it("resumes a failed import at the page that failed, without re-syncing earlier pages", async () => {
    let failSecondPage = true;
    adapter.listBackfillPage.mockImplementation(async (_r, _m, cursor) => {
      if (cursor === null) return { items: [item(1)], nextCursor: "page:2" };
      if (failSecondPage) {
        failSecondPage = false;
        throw new Error("GitHub rate limit");
      }
      return { items: [item(2)], nextCursor: null };
    });
    await enqueue(db, "backfill", { repositoryId });

    await runJobs(db, handlers);
    expect(await db.select().from(workItems)).toHaveLength(1);
    expect(
      (await backfillStatuses(db, [repositoryId])).get(repositoryId),
    ).toEqual({ state: "retrying", error: "GitHub rate limit" });

    // The retry is due.
    await db.update(jobs).set({ runAfter: new Date(0) });
    await runJobs(db, handlers);

    const cursors = adapter.listBackfillPage.mock.calls.map((call) => call[2]);
    expect(cursors).toEqual([null, "page:2", "page:2"]);
    expect(await db.select().from(workItems)).toHaveLength(2);
    expect(
      (await backfillStatuses(db, [repositoryId])).get(repositoryId),
    ).toEqual({ state: "done" });
  });

  it("reports an import that gave up, with its error", async () => {
    adapter.listBackfillPage.mockRejectedValue(new Error("Bad credentials"));
    await enqueue(db, "backfill", { repositoryId });
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      await db.update(jobs).set({ runAfter: new Date(0) });
      await runJobs(db, handlers);
    }

    const neverImported = "00000000-0000-0000-0000-000000000000";
    expect(await backfillStatuses(db, [repositoryId, neverImported])).toEqual(
      new Map([[repositoryId, { state: "failed", error: "Bad credentials" }]]),
    );
  });
});
