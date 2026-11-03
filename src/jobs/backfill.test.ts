/** Tests for the backfill job with a fake source adapter. */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SourceAdapter, SourceWorkItem } from "@/adapters/source";
import { projects, repositories, workItems } from "@/db/schema";
import { createTestDb } from "@/db/test-db";

import { runBackfill } from "./backfill";

type TestDb = Awaited<ReturnType<typeof createTestDb>>;

let db: TestDb;
let repositoryId: string;

const issue: SourceWorkItem = {
  source: "github",
  externalId: "acme/analytics#7",
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
      "acme/analytics",
      new Date("2026-08-05T00:00:00Z"),
    );
    expect(await db.select().from(workItems)).toHaveLength(1);
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
