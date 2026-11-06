/** Tests for syncWorkItem with Linear issues as work items, against an in-memory database. */
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { FakeLLMProvider } from "@/adapters/llm/fake";
import type { SourceWorkItem } from "@/adapters/source";
import { SAMPLE_RECONCILE_OUTPUTS } from "@/agents/fixtures";
import { RECONCILE_TASK, runReconcile } from "@/agents/reconcile";
import {
  events,
  jobs,
  links,
  projects,
  proposals,
  requirements,
  workItems,
} from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import { runJobs } from "@/jobs/queue";

import { applyProposal } from "./proposals";
import { LINEAR_SYNC_ACTOR, syncWorkItem } from "./work-items";

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

function linearIssue(overrides: Partial<SourceWorkItem> = {}): SourceWorkItem {
  return {
    source: "linear",
    externalId: "8f2c1d3e-linear-issue",
    kind: "issue",
    title: "CSV export button",
    body: "Implements TL-1",
    url: "https://linear.app/acme/issue/ENG-12/csv-export-button",
    state: "open",
    people: ["maya"],
    mergedAt: null,
    closedAt: null,
    updatedAt: new Date("2026-11-01T09:00:00.000Z"),
    started: false,
    inProject: true,
    teamKey: "ENG",
    ...overrides,
  };
}

const completed = (overrides: Partial<SourceWorkItem> = {}) =>
  linearIssue({
    state: "closed",
    closedAt: new Date("2026-11-02T09:00:00.000Z"),
    updatedAt: new Date("2026-11-02T09:00:00.000Z"),
    ...overrides,
  });

const jobsOfType = (type: "reconcile" | "link_suggest") =>
  db.select().from(jobs).where(eq(jobs.type, type));

async function statusOf(key: string): Promise<string | null> {
  const [row] = await db
    .select({ status: requirements.status })
    .from(requirements)
    .where(eq(requirements.key, key));
  return row.status;
}

describe("syncWorkItem with a Linear issue", () => {
  it("stores a Linear work item, which the migration's enum value allows", async () => {
    const { workItemId } = await syncWorkItem(db, projectId, linearIssue());
    const [row] = await db
      .select()
      .from(workItems)
      .where(eq(workItems.id, workItemId));
    expect(row).toMatchObject({
      source: "linear",
      kind: "issue",
      externalId: "8f2c1d3e-linear-issue",
      state: "open",
    });
  });

  it("links explicit references, recording the Linear sync as the actor", async () => {
    const { workItemId, linked } = await syncWorkItem(
      db,
      projectId,
      linearIssue({ body: "Implements TL-1\nPart of TL-2" }),
    );
    expect(linked).toEqual(["TL-1", "TL-2"]);
    expect(await db.$count(links, eq(links.workItemId, workItemId))).toBe(2);
    const linkEvents = await db
      .select({ actor: events.actor })
      .from(events)
      .where(eq(events.type, "link_work_item"));
    expect(linkEvents.map((event) => event.actor)).toEqual([
      LINEAR_SYNC_ACTOR,
      LINEAR_SYNC_ACTOR,
    ]);
  });

  it("ignores references in the issues of a team keyed TL", async () => {
    const result = await syncWorkItem(
      db,
      projectId,
      completed({ teamKey: "TL", body: "Implements TL-1, blocked by TL-2" }),
    );
    expect(result).toMatchObject({ linked: [], reconcileJobs: 0 });
    expect(await db.$count(links)).toBe(0);
    // Its links come from suggestions instead.
    expect(result.linkSuggestJob).toBe(true);
  });

  it("does not start work while the issue is not started", async () => {
    const result = await syncWorkItem(db, projectId, linearIssue());
    expect(result.started).toEqual([]);
    expect(await statusOf("TL-1")).toBe("planned");
  });

  it("marks the linked requirement in progress when the issue moves to In Progress", async () => {
    await syncWorkItem(db, projectId, linearIssue());
    const result = await syncWorkItem(
      db,
      projectId,
      linearIssue({
        started: true,
        updatedAt: new Date("2026-11-01T10:00:00.000Z"),
      }),
    );
    expect(result.started).toEqual(["TL-1"]);
    expect(await statusOf("TL-1")).toBe("in_progress");
    const [proposal] = await db
      .select()
      .from(proposals)
      .where(eq(proposals.source, "work_started"));
    expect(proposal).toMatchObject({
      status: "approved",
      decidedBy: LINEAR_SYNC_ACTOR,
    });
  });

  it("queues reconciliation when an issue that references a requirement completes", async () => {
    await syncWorkItem(db, projectId, linearIssue({ started: true }));
    const result = await syncWorkItem(db, projectId, completed());
    expect(result.reconcileJobs).toBe(1);
    expect(await jobsOfType("reconcile")).toHaveLength(1);
    expect(result.linkSuggestJob).toBe(false);
  });

  it("does not reconcile a canceled issue", async () => {
    const result = await syncWorkItem(
      db,
      projectId,
      linearIssue({ state: "not_planned", closedAt: new Date() }),
    );
    expect(result.reconcileJobs).toBe(0);
    expect(await jobsOfType("reconcile")).toHaveLength(0);
  });

  it("ignores a delivery older than the stored issue", async () => {
    await syncWorkItem(db, projectId, completed());
    const late = await syncWorkItem(db, projectId, linearIssue());
    expect(late.reconcileJobs).toBe(0);
    const [row] = await db.select().from(workItems);
    expect(row.state).toBe("closed");
  });
});

describe("link suggestions for finished work", () => {
  it("suggests a link for an unreferenced issue completed inside a Linear project", async () => {
    const result = await syncWorkItem(
      db,
      projectId,
      completed({ body: "No reference here." }),
    );
    expect(result.linkSuggestJob).toBe(true);
    expect(await jobsOfType("link_suggest")).toHaveLength(1);
  });

  it("suggests nothing for an unreferenced issue outside any project", async () => {
    const result = await syncWorkItem(
      db,
      projectId,
      completed({ body: "Fix a typo.", inProject: false }),
    );
    expect(result.linkSuggestJob).toBe(false);
    expect(await jobsOfType("link_suggest")).toHaveLength(0);
  });

  it("suggests nothing for a closed GitHub issue", async () => {
    const result = await syncWorkItem(db, projectId, {
      source: "github",
      externalId: "4242#7",
      kind: "issue",
      title: "Exports are slow",
      body: "No reference here.",
      url: "https://github.com/acme/analytics/issues/7",
      state: "closed",
      people: [],
      mergedAt: null,
      closedAt: new Date("2026-11-02"),
      updatedAt: new Date("2026-11-02"),
    });
    expect(result.linkSuggestJob).toBe(false);
    expect(await jobsOfType("link_suggest")).toHaveLength(0);
  });

  it("does not suggest links during a backfill", async () => {
    const result = await syncWorkItem(
      db,
      projectId,
      completed({ body: "No reference here." }),
      { reconcile: false },
    );
    expect(result.linkSuggestJob).toBe(false);
  });
});

describe("one piece of work, one reconciliation", () => {
  // Linear attaches the PR that fixes an issue, so both reach TL-1 and both queue a reconcile.
  const pull: SourceWorkItem = {
    source: "github",
    externalId: "4242#41",
    kind: "pull_request",
    title: "Add CSV export",
    body: "Implements TL-1\n\nFixes ENG-12",
    url: "https://github.com/acme/analytics/pull/41",
    state: "merged",
    people: ["maya"],
    mergedAt: new Date("2026-11-02T09:05:00.000Z"),
    closedAt: new Date("2026-11-02T09:05:00.000Z"),
    updatedAt: new Date("2026-11-02T09:05:00.000Z"),
  };

  // Runs every due reconcile job the way the job runner does, then marks it done.
  const runQueuedReconciles = () =>
    runJobs(db, {
      reconcile: async (payload) => {
        await runReconcile(
          db,
          new FakeLLMProvider({
            [RECONCILE_TASK]: [SAMPLE_RECONCILE_OUTPUTS.fully_done],
          }),
          null,
          payload,
        );
      },
    });

  const pendingReconciles = async () => {
    const [{ id }] = await db
      .select({ id: requirements.id })
      .from(requirements)
      .where(eq(requirements.key, "TL-1"));
    return db
      .select()
      .from(proposals)
      .where(
        and(
          eq(proposals.requirementId, id),
          eq(proposals.source, "reconcile"),
          eq(proposals.status, "pending"),
        ),
      );
  };

  it("folds the two into one run when both finish before it starts", async () => {
    await syncWorkItem(db, projectId, completed());
    await syncWorkItem(db, projectId, pull);
    expect(await jobsOfType("reconcile")).toHaveLength(1);
    await runQueuedReconciles();

    expect(await pendingReconciles()).toHaveLength(1);
    expect(await db.$count(proposals, eq(proposals.source, "reconcile"))).toBe(
      1,
    );
  });

  it("leaves one pending proposal when the PR merges after the issue was reconciled", async () => {
    await syncWorkItem(db, projectId, completed());
    await runQueuedReconciles();
    await syncWorkItem(db, projectId, pull);
    await runQueuedReconciles();

    expect(await pendingReconciles()).toHaveLength(1);
    expect(
      await db.$count(
        proposals,
        and(
          eq(proposals.source, "reconcile"),
          eq(proposals.status, "superseded"),
        ),
      ),
    ).toBe(1);
  });

  it("makes no second proposal once the first is approved", async () => {
    await syncWorkItem(db, projectId, pull);
    await runQueuedReconciles();
    const [first] = await pendingReconciles();
    await applyProposal(db, first.id, "pm");
    await syncWorkItem(db, projectId, completed());
    await runQueuedReconciles();

    expect(await statusOf("TL-1")).toBe("done");
    expect(await pendingReconciles()).toHaveLength(0);
    expect(await db.$count(proposals, eq(proposals.source, "reconcile"))).toBe(
      1,
    );
  });
});
