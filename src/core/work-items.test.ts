/** Tests for syncWorkItem and syncRepositoryItem against an in-memory database. */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import type { SourceWorkItem } from "@/adapters/source";
import {
  events,
  jobs,
  links,
  projects,
  proposals,
  repositories,
  requirements,
  workItems,
} from "@/db/schema";
import { createTestDb } from "@/db/test-db";

import { applyProposal } from "./proposals";
import { SYNC_ACTOR, syncRepositoryItem, syncWorkItem } from "./work-items";

type TestDb = Awaited<ReturnType<typeof createTestDb>>;

let db: TestDb;
let projectId: string;

beforeEach(async () => {
  db = await createTestDb();
  [{ id: projectId }] = await db
    .insert(projects)
    .values({ name: "Test", slug: "test" })
    .returning();
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
        {
          type: "create_requirement",
          key: "TL-2",
          outcome_key: "OUT-1",
          title: "Excel",
        },
      ],
    })
    .returning();
  await applyProposal(db, proposal.id, "pm");
});

function pr(overrides: Partial<SourceWorkItem> = {}): SourceWorkItem {
  return {
    source: "github",
    externalId: "acme/analytics#41",
    kind: "pull_request",
    title: "Add CSV export",
    body: "Implements TL-1",
    url: "https://github.com/acme/analytics/pull/41",
    state: "open",
    mergedAt: null,
    closedAt: null,
    ...overrides,
  };
}

const merged = (overrides: Partial<SourceWorkItem> = {}): SourceWorkItem =>
  pr({
    state: "merged",
    mergedAt: new Date("2026-11-01"),
    closedAt: new Date("2026-11-01"),
    ...overrides,
  });

async function linkedKeys(workItemId: string): Promise<string[]> {
  const rows = await db
    .select({ key: requirements.key, relation: links.relation })
    .from(links)
    .innerJoin(requirements, eq(links.requirementId, requirements.id))
    .where(eq(links.workItemId, workItemId));
  return rows.map((row) => `${row.key}:${row.relation}`).sort();
}

const reconcileJobs = () =>
  db.select().from(jobs).where(eq(jobs.type, "reconcile"));

describe("syncWorkItem", () => {
  it("stores the work item and updates it in place on later syncs", async () => {
    const first = await syncWorkItem(
      db,
      projectId,
      pr({ body: "x".repeat(5000) }),
    );
    const second = await syncWorkItem(
      db,
      projectId,
      pr({ title: "Add CSV and TSV export" }),
    );

    expect(second.workItemId).toBe(first.workItemId);
    const rows = await db.select().from(workItems);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: "Add CSV and TSV export",
      state: "open",
    });
  });

  it("keeps only an excerpt of a long body", async () => {
    await syncWorkItem(db, projectId, pr({ body: "x".repeat(5000) }));
    const [row] = await db.select().from(workItems);
    expect(row.bodyExcerpt).toHaveLength(2000);
  });

  it("links explicit references through an approved proposal with events", async () => {
    const { workItemId, linked } = await syncWorkItem(
      db,
      projectId,
      pr({ body: "implements tl-1\nPart of TL-2" }),
    );

    expect(linked).toEqual(["TL-1", "TL-2"]);
    expect(await linkedKeys(workItemId)).toEqual([
      "TL-1:implements",
      "TL-2:part_of",
    ]);
    const [proposal] = await db
      .select()
      .from(proposals)
      .where(eq(proposals.source, "explicit_link"));
    expect(proposal).toMatchObject({
      status: "approved",
      decidedBy: SYNC_ACTOR,
      triggerWorkItemId: workItemId,
    });
    const linkEvents = await db
      .select()
      .from(events)
      .where(eq(events.proposalId, proposal.id));
    expect(linkEvents.map((event) => event.actor)).toEqual([
      SYNC_ACTOR,
      SYNC_ACTOR,
    ]);
  });

  it("ignores keys that do not exist in the project", async () => {
    const { workItemId, linked } = await syncWorkItem(
      db,
      projectId,
      pr({ body: "Implements TL-1, TL-99 and OUT-1" }),
    );
    expect(linked).toEqual(["TL-1"]);
    expect(await linkedKeys(workItemId)).toEqual(["TL-1:implements"]);
  });

  it("creates no proposal when nothing new is referenced", async () => {
    await syncWorkItem(db, projectId, pr({ body: "No references here" }));
    expect(
      await db
        .select()
        .from(proposals)
        .where(eq(proposals.source, "explicit_link")),
    ).toEqual([]);
  });

  it("does not duplicate anything when the same item is synced twice", async () => {
    await syncWorkItem(db, projectId, merged());
    const replay = await syncWorkItem(db, projectId, merged());

    expect(replay).toMatchObject({ linked: [], reconcileJobs: 0 });
    expect(await db.select().from(workItems)).toHaveLength(1);
    expect(await db.select().from(links)).toHaveLength(1);
    expect(
      await db
        .select()
        .from(proposals)
        .where(eq(proposals.source, "explicit_link")),
    ).toHaveLength(1);
    expect(await reconcileJobs()).toHaveLength(1);
  });

  it("queues reconciliation for every linked requirement when a PR merges", async () => {
    const { workItemId } = await syncWorkItem(
      db,
      projectId,
      pr({ body: "Implements TL-1, TL-2" }),
    );
    expect(await reconcileJobs()).toEqual([]);

    const result = await syncWorkItem(
      db,
      projectId,
      merged({ body: "Implements TL-1, TL-2" }),
    );

    expect(result.reconcileJobs).toBe(2);
    const queued = await reconcileJobs();
    expect(queued.map((job) => job.status)).toEqual(["queued", "queued"]);
    const tl = await db.select().from(requirements);
    expect(queued.map((job) => job.payload)).toEqual(
      expect.arrayContaining(
        tl.map((requirement) => ({
          workItemId,
          requirementId: requirement.id,
        })),
      ),
    );
  });

  it("queues reconciliation for a PR first seen already merged", async () => {
    expect((await syncWorkItem(db, projectId, merged())).reconcileJobs).toBe(1);
  });

  it("queues reconciliation only for the new link when a merged PR gains a reference", async () => {
    await syncWorkItem(db, projectId, merged());
    const result = await syncWorkItem(
      db,
      projectId,
      merged({ body: "Implements TL-1. Part of TL-2" }),
    );

    expect(result).toMatchObject({ linked: ["TL-2"], reconcileJobs: 1 });
    expect(await reconcileJobs()).toHaveLength(2);
  });

  it("does not reconcile a merged PR with no links or a PR closed without merging", async () => {
    await syncWorkItem(
      db,
      projectId,
      merged({ externalId: "acme/analytics#1", body: "" }),
    );
    await syncWorkItem(
      db,
      projectId,
      pr({
        externalId: "acme/analytics#2",
        state: "closed",
        closedAt: new Date(),
      }),
    );
    expect(await reconcileJobs()).toEqual([]);
  });

  it("reconciles a linked issue each time it is closed", async () => {
    const issue = pr({
      kind: "issue",
      externalId: "acme/analytics#7",
      body: "Part of TL-2",
    });
    await syncWorkItem(db, projectId, { ...issue, state: "closed" });
    await syncWorkItem(db, projectId, { ...issue, state: "closed" });
    await syncWorkItem(db, projectId, { ...issue, state: "open" });
    await syncWorkItem(db, projectId, { ...issue, state: "closed" });
    expect(await reconcileJobs()).toHaveLength(2);
  });
});

describe("syncRepositoryItem", () => {
  it("syncs into every project the repository is connected to", async () => {
    await db.insert(repositories).values({
      projectId,
      source: "github",
      externalId: "4242",
      fullName: "acme/analytics",
    });
    const results = await syncRepositoryItem(db, "4242", pr());
    expect(results).toHaveLength(1);
    expect(await db.select().from(workItems)).toHaveLength(1);
  });

  it("does nothing for a repository that is not connected", async () => {
    expect(await syncRepositoryItem(db, "9999", pr())).toEqual([]);
    expect(await db.select().from(workItems)).toEqual([]);
  });
});
