/** Tests for syncWorkItem, syncFeedback and syncRepositoryItem against an in-memory database. */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import type { SourceFeedback, SourceWorkItem } from "@/adapters/source";
import {
  events,
  feedback,
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
import {
  SYNC_ACTOR,
  syncFeedback,
  syncRepositoryItem,
  syncWorkItem,
} from "./work-items";

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
    externalId: "4242#41",
    kind: "pull_request",
    title: "Add CSV export",
    body: "Implements TL-1",
    url: "https://github.com/acme/analytics/pull/41",
    state: "open",
    people: ["maya"],
    mergedAt: null,
    closedAt: null,
    updatedAt: new Date("2026-11-01T09:00:00Z"),
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
      pr({
        title: "Add CSV and TSV export",
        people: ["maya", "sam"],
        updatedAt: new Date("2026-11-01T10:00:00Z"),
      }),
    );

    expect(second.workItemId).toBe(first.workItemId);
    const rows = await db.select().from(workItems);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: "Add CSV and TSV export",
      state: "open",
      people: ["maya", "sam"],
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
      merged({ externalId: "4242#1", body: "" }),
    );
    await syncWorkItem(
      db,
      projectId,
      pr({
        externalId: "4242#2",
        state: "closed",
        closedAt: new Date(),
      }),
    );
    expect(await reconcileJobs()).toEqual([]);
  });

  it("reconciles a linked issue each time it is closed", async () => {
    const issue = pr({
      kind: "issue",
      externalId: "4242#7",
      body: "Part of TL-2",
    });
    await syncWorkItem(db, projectId, { ...issue, state: "closed" });
    await syncWorkItem(db, projectId, { ...issue, state: "closed" });
    // Once the first reconciliation has run, closing it again queues another.
    await db.update(jobs).set({ status: "done" });
    await syncWorkItem(db, projectId, { ...issue, state: "open" });
    await syncWorkItem(db, projectId, { ...issue, state: "closed" });
    expect(await reconcileJobs()).toHaveLength(2);
  });

  it("folds reconciliations that arrive before the first one runs into one job", async () => {
    await syncWorkItem(db, projectId, merged());
    const second = await syncWorkItem(
      db,
      projectId,
      merged({ externalId: "4242#42", title: "CSV export follow-up" }),
    );

    expect(second.reconcileJobs).toBe(1);
    const queued = await reconcileJobs();
    expect(queued).toHaveLength(1);
    expect(queued[0].payload).toMatchObject({ workItemId: second.workItemId });
  });

  it("does not reconcile an issue closed as not planned", async () => {
    await syncWorkItem(
      db,
      projectId,
      pr({ kind: "issue", body: "Part of TL-2", state: "not_planned" }),
    );
    expect(await db.select().from(links)).toHaveLength(1);
    expect(await reconcileJobs()).toEqual([]);
  });

  it("ignores a delivery older than the stored item", async () => {
    const opened = pr({ kind: "issue", externalId: "4242#7" });
    const closedEdited = {
      ...opened,
      title: "Edited title",
      state: "closed" as const,
      closedAt: new Date("2026-11-02T10:00:00Z"),
      updatedAt: new Date("2026-11-02T10:00:00Z"),
    };
    const closed = await syncWorkItem(db, projectId, closedEdited);
    const late = await syncWorkItem(db, projectId, opened);
    // Had the late delivery reopened the issue, this would count as a new close.
    const closedAgain = await syncWorkItem(db, projectId, closedEdited);

    expect(late).toEqual({
      workItemId: closed.workItemId,
      linked: [],
      started: [],
      reconcileJobs: 0,
      linkSuggestJob: false,
    });
    expect(closedAgain.reconcileJobs).toBe(0);
    expect(await reconcileJobs()).toHaveLength(1);
    const [row] = await db.select().from(workItems);
    expect(row).toMatchObject({ state: "closed", title: "Edited title" });
  });

  it("links but does not reconcile when told not to", async () => {
    const result = await syncWorkItem(db, projectId, merged(), {
      reconcile: false,
    });
    expect(result).toMatchObject({ linked: ["TL-1"], reconcileJobs: 0 });
    expect(await reconcileJobs()).toEqual([]);
  });
});

describe("syncWorkItem work started", () => {
  async function status(key: string): Promise<string | null> {
    const [row] = await db
      .select({ status: requirements.status })
      .from(requirements)
      .where(eq(requirements.key, key));
    return row.status;
  }

  it("moves a planned requirement to in progress when an open PR references it", async () => {
    const result = await syncWorkItem(db, projectId, pr());

    expect(result).toMatchObject({ linked: ["TL-1"], started: ["TL-1"] });
    expect(await status("TL-1")).toBe("in_progress");
    expect(await status("TL-2")).toBe("planned");

    const [proposal] = await db
      .select()
      .from(proposals)
      .where(eq(proposals.source, "work_started"));
    expect(proposal).toMatchObject({
      status: "approved",
      decidedBy: SYNC_ACTOR,
      triggerWorkItemId: result.workItemId,
      summary: 'Work started on TL-1: "Add CSV export"',
    });
    const [event] = await db
      .select()
      .from(events)
      .where(eq(events.type, "set_status"));
    expect(event).toMatchObject({
      actor: SYNC_ACTOR,
      payload: { requirement_key: "TL-1", status: "in_progress" },
    });
  });

  it("starts nothing twice, and nothing that is not planned", async () => {
    await syncWorkItem(db, projectId, pr());
    const replay = await syncWorkItem(db, projectId, pr());
    expect(replay.started).toEqual([]);

    // A second PR against work already started changes nothing.
    const another = await syncWorkItem(
      db,
      projectId,
      pr({ externalId: "4242#43", title: "CSV export: headers" }),
    );
    expect(another).toMatchObject({ linked: ["TL-1"], started: [] });
    expect(
      await db.$count(proposals, eq(proposals.source, "work_started")),
    ).toBe(1);
  });

  it("starts a requirement when a reference is added to an open PR later", async () => {
    await syncWorkItem(db, projectId, pr({ body: "No reference yet" }));
    const edited = await syncWorkItem(
      db,
      projectId,
      pr({
        body: "Implements TL-2",
        updatedAt: new Date("2026-11-01T10:00:00Z"),
      }),
    );
    expect(edited).toMatchObject({ linked: ["TL-2"], started: ["TL-2"] });
  });

  it("does not start work for an issue, or for a PR first seen merged", async () => {
    const issue = await syncWorkItem(
      db,
      projectId,
      pr({ kind: "issue", externalId: "4242#7", body: "Part of TL-2" }),
    );
    expect(issue.started).toEqual([]);
    expect(await status("TL-2")).toBe("planned");

    // Merged work goes to reconciliation instead; the agent decides whether it is done.
    const done = await syncWorkItem(db, projectId, merged());
    expect(done).toMatchObject({ started: [], reconcileJobs: 1 });
    expect(await status("TL-1")).toBe("planned");
  });
});

describe("syncWorkItem link suggestions", () => {
  const linkSuggestJobs = () =>
    db.select().from(jobs).where(eq(jobs.type, "link_suggest"));

  it("queues one suggestion when a pull request with no reference merges", async () => {
    await syncWorkItem(db, projectId, pr({ body: "Tidy up" }));
    const result = await syncWorkItem(
      db,
      projectId,
      merged({ body: "Tidy up" }),
    );
    await syncWorkItem(db, projectId, merged({ body: "Tidy up" }));

    expect(result.linkSuggestJob).toBe(true);
    expect((await linkSuggestJobs()).map((job) => job.payload)).toEqual([
      { workItemId: result.workItemId },
    ]);
  });

  it("supersedes a pending suggestion once the pull request references a requirement", async () => {
    const { workItemId } = await syncWorkItem(
      db,
      projectId,
      merged({ body: "Tidy up" }),
    );
    const [suggestion] = await db
      .insert(proposals)
      .values({
        projectId,
        source: "link_suggest",
        summary: "Link to TL-2",
        operations: [
          {
            type: "link_work_item",
            requirement_key: "TL-2",
            work_item_id: workItemId,
            confidence: "suggested",
          },
        ],
        triggerWorkItemId: workItemId,
      })
      .returning();

    await syncWorkItem(db, projectId, merged({ body: "Implements TL-1" }));

    const [after] = await db
      .select()
      .from(proposals)
      .where(eq(proposals.id, suggestion.id));
    expect(after).toMatchObject({
      status: "superseded",
      decidedBy: SYNC_ACTOR,
    });
  });

  it("does not suggest a link for a pull request that references a requirement", async () => {
    expect((await syncWorkItem(db, projectId, merged())).linkSuggestJob).toBe(
      false,
    );
    expect(await linkSuggestJobs()).toEqual([]);
  });

  it("does not suggest links for closed issues or backfilled pull requests", async () => {
    await syncWorkItem(
      db,
      projectId,
      pr({ kind: "issue", body: "", state: "closed" }),
    );
    await syncWorkItem(
      db,
      projectId,
      merged({ externalId: "4242#42", body: "" }),
      { reconcile: false },
    );
    expect(await linkSuggestJobs()).toEqual([]);
  });
});

function feedbackItem(overrides: Partial<SourceFeedback> = {}): SourceFeedback {
  return {
    source: "github",
    kind: "feedback",
    externalId: "4242#50",
    title: "Please add Excel export",
    body: "Finance can't open CSV files.",
    url: "https://github.com/acme/analytics/issues/50",
    updatedAt: new Date("2026-11-01T09:00:00Z"),
    ...overrides,
  };
}

const sameIssue = (overrides: Partial<SourceWorkItem> = {}): SourceWorkItem =>
  pr({
    externalId: "4242#50",
    kind: "issue",
    title: "Please add Excel export",
    body: "",
    url: "https://github.com/acme/analytics/issues/50",
    ...overrides,
  });

describe("syncFeedback", () => {
  it("stores new feedback and queues one match, however often it is delivered", async () => {
    const first = await syncFeedback(db, projectId, feedbackItem());
    const again = await syncFeedback(db, projectId, feedbackItem());

    expect(first.matchJob).toBe(true);
    expect(again).toEqual({ feedbackId: first.feedbackId, matchJob: false });
    expect(await db.select().from(feedback)).toMatchObject([
      {
        title: "Please add Excel export",
        bodyExcerpt: "Finance can't open CSV files.",
        withdrawn: false,
      },
    ]);
    expect(await db.select().from(jobs)).toMatchObject([
      { type: "feedback_match", payload: { feedbackId: first.feedbackId } },
    ]);
    // Feedback is not work, so nothing becomes a work item.
    expect(await db.$count(workItems)).toBe(0);
  });

  it("ignores a delivery older than the stored copy", async () => {
    await syncFeedback(db, projectId, feedbackItem());
    await syncFeedback(
      db,
      projectId,
      feedbackItem({
        title: "Old title",
        updatedAt: new Date("2026-10-01T09:00:00Z"),
      }),
    );

    const [stored] = await db.select().from(feedback);
    expect(stored.title).toBe("Please add Excel export");
  });

  it("withdraws feedback whose label was removed, and counts it again when relabelled", async () => {
    const { feedbackId } = await syncFeedback(db, projectId, feedbackItem());
    const [match] = await db
      .insert(proposals)
      .values({
        projectId,
        source: "feedback_match",
        summary: "Count it towards OUT-1",
        operations: [
          {
            type: "link_feedback",
            outcome_key: "OUT-1",
            feedback_id: feedbackId,
          },
        ],
        triggerFeedbackId: feedbackId,
      })
      .returning();

    await syncWorkItem(
      db,
      projectId,
      sameIssue({ updatedAt: new Date("2026-11-02T09:00:00Z") }),
    );
    const [withdrawn] = await db.select().from(feedback);
    expect(withdrawn.withdrawn).toBe(true);
    const [superseded] = await db
      .select()
      .from(proposals)
      .where(eq(proposals.id, match.id));
    expect(superseded).toMatchObject({
      status: "superseded",
      decidedBy: SYNC_ACTOR,
    });

    await syncFeedback(
      db,
      projectId,
      feedbackItem({ updatedAt: new Date("2026-11-03T09:00:00Z") }),
    );
    const [back] = await db.select().from(feedback);
    expect(back.withdrawn).toBe(false);
    // Its match was superseded, so it is sorted again.
    expect(await db.$count(jobs, eq(jobs.type, "feedback_match"))).toBe(2);
  });

  it("does not withdraw feedback for an issue delivery older than the feedback", async () => {
    await syncFeedback(db, projectId, feedbackItem());
    await syncWorkItem(
      db,
      projectId,
      sameIssue({ updatedAt: new Date("2026-10-01T09:00:00Z") }),
    );

    const [stored] = await db.select().from(feedback);
    expect(stored.withdrawn).toBe(false);
  });
});

describe("syncRepositoryItem", () => {
  const repository = { externalId: "4242", fullName: "acme/analytics" };

  it("syncs into every project the repository is connected to", async () => {
    await db.insert(repositories).values({
      projectId,
      source: "github",
      externalId: "4242",
      fullName: "acme/analytics",
    });
    expect(await syncRepositoryItem(db, repository, pr())).toBe(1);
    expect(await db.select().from(workItems)).toHaveLength(1);
  });

  it("records a new repository name and keeps the same work item after a rename", async () => {
    await db.insert(repositories).values({
      projectId,
      source: "github",
      externalId: "4242",
      fullName: "acme/old-name",
    });
    await syncRepositoryItem(
      db,
      { ...repository, fullName: "acme/old-name" },
      pr(),
    );
    await syncRepositoryItem(db, repository, pr({ title: "Renamed repo" }));

    const [stored] = await db.select().from(repositories);
    expect(stored.fullName).toBe("acme/analytics");
    expect(await db.select().from(workItems)).toEqual([
      expect.objectContaining({ title: "Renamed repo" }),
    ]);
  });

  it("syncs feedback as feedback, not as a work item", async () => {
    await db.insert(repositories).values({
      projectId,
      source: "github",
      externalId: "4242",
      fullName: "acme/analytics",
    });

    expect(await syncRepositoryItem(db, repository, feedbackItem())).toBe(1);
    expect(await db.$count(feedback)).toBe(1);
    expect(await db.$count(workItems)).toBe(0);
  });

  it("skips an issue delivery from before the issue was labelled as feedback", async () => {
    await db.insert(repositories).values({
      projectId,
      source: "github",
      externalId: "4242",
      fullName: "acme/analytics",
    });
    // The labelled delivery arrives first; the earlier unlabelled one arrives after it.
    await syncRepositoryItem(db, repository, feedbackItem());
    await syncRepositoryItem(
      db,
      repository,
      sameIssue({ body: "TL-1", updatedAt: new Date("2026-10-01T09:00:00Z") }),
    );

    expect(await db.$count(workItems)).toBe(0);
    const [stored] = await db.select().from(feedback);
    expect(stored.withdrawn).toBe(false);
  });

  it("does nothing for a repository that is not connected", async () => {
    expect(
      await syncRepositoryItem(db, { ...repository, externalId: "9999" }, pr()),
    ).toBe(0);
    expect(await db.select().from(workItems)).toEqual([]);
  });
});
