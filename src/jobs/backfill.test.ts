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

import { runBackfill } from "./backfill";

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
};

const adapter = {
  source: "github",
  findRepository: async () => null,
  listBackfill: vi.fn(async () => [issue]),
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
  adapter.listBackfill.mockClear();
});

describe("runBackfill", () => {
  it("asks for PRs merged in the last 90 days and stores what it gets", async () => {
    await runBackfill(
      db,
      adapter,
      repositoryId,
      new Date("2026-11-03T00:00:00Z"),
    );

    expect(adapter.listBackfill).toHaveBeenCalledWith(
      expect.objectContaining({
        externalId: "4242",
        fullName: "acme/analytics",
      }),
      new Date("2026-08-05T00:00:00Z"),
    );
    expect(await db.select().from(workItems)).toHaveLength(1);
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
    adapter.listBackfill.mockResolvedValueOnce([
      {
        ...issue,
        externalId: "4242#9",
        kind: "pull_request",
        body: "Implements TL-1",
        state: "merged",
        mergedAt: new Date("2026-10-01"),
      },
    ]);
    await runBackfill(db, adapter, repositoryId);

    expect(await db.select().from(links)).toHaveLength(1);
    expect(
      await db.select().from(jobs).where(eq(jobs.type, "reconcile")),
    ).toEqual([]);
  });

  it("can run twice without duplicating work items", async () => {
    await runBackfill(db, adapter, repositoryId);
    await runBackfill(db, adapter, repositoryId);
    expect(await db.select().from(workItems)).toHaveLength(1);
  });

  it("does nothing for a repository that was disconnected", async () => {
    await runBackfill(db, adapter, "00000000-0000-0000-0000-000000000000");
    expect(adapter.listBackfill).not.toHaveBeenCalled();
  });
});
