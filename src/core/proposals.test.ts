/** Tests for applyProposal and rejectProposal against an in-memory database. */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  events,
  links,
  outcomes,
  projects,
  proposals,
  requirements,
  workItems,
} from "@/db/schema";
import { createTestDb } from "@/db/test-db";

import type { GraphOperationInput } from "./operations";
import { applyProposal, ProposalError, rejectProposal } from "./proposals";

type TestDb = Awaited<ReturnType<typeof createTestDb>>;

let db: TestDb;
let projectId: string;

beforeEach(async () => {
  db = await createTestDb();
  [{ id: projectId }] = await db
    .insert(projects)
    .values({ name: "Test", slug: "test" })
    .returning();
});

async function propose(operations: GraphOperationInput[]): Promise<string> {
  const [proposal] = await db
    .insert(proposals)
    .values({ projectId, source: "import", summary: "Test", operations })
    .returning();
  return proposal.id;
}

async function approve(operations: GraphOperationInput[]): Promise<void> {
  await applyProposal(db, await propose(operations), "pm");
}

async function requirementByKey(
  key: string,
): Promise<typeof requirements.$inferSelect> {
  const [requirement] = await db
    .select()
    .from(requirements)
    .where(eq(requirements.key, key));
  return requirement;
}

async function snapshot(): Promise<Record<string, unknown[]>> {
  return {
    outcomes: await db.select().from(outcomes),
    requirements: await db.select().from(requirements),
    links: await db.select().from(links),
    events: await db.select().from(events),
  };
}

const exportOutcome: GraphOperationInput[] = [
  { type: "create_outcome", key: "OUT-1", title: "Export to Excel" },
  {
    type: "create_requirement",
    key: "TL-1",
    outcome_key: "OUT-1",
    title: "Async export service",
    user_visible: true,
  },
];

describe("applyProposal", () => {
  it("applies every operation, writes one event each and marks the proposal approved", async () => {
    const proposalId = await propose(exportOutcome);

    await applyProposal(db, proposalId, "pm");

    const [outcome] = await db.select().from(outcomes);
    const tl1 = await requirementByKey("TL-1");
    expect(tl1).toMatchObject({ outcomeId: outcome.id, status: "planned" });

    const written = await db.select().from(events);
    expect(written.map((e) => e.type)).toEqual([
      "create_outcome",
      "create_requirement",
    ]);
    expect(written.every((e) => e.actor === "pm")).toBe(true);
    expect(written.every((e) => e.proposalId === proposalId)).toBe(true);

    const [proposal] = await db.select().from(proposals);
    expect(proposal).toMatchObject({ status: "approved", decidedBy: "pm" });
    expect(proposal.decidedAt).toBeInstanceOf(Date);
  });

  it("changes nothing when any operation fails", async () => {
    await approve(exportOutcome);
    const before = await snapshot();
    const proposalId = await propose([
      { type: "set_status", requirement_key: "TL-1", status: "done" },
      { type: "set_status", requirement_key: "TL-404", status: "done" },
    ]);

    await expect(applyProposal(db, proposalId, "pm")).rejects.toThrow(
      "Requirement TL-404 not found",
    );

    expect(await snapshot()).toEqual(before);
    const [proposal] = await db
      .select()
      .from(proposals)
      .where(eq(proposals.id, proposalId));
    expect(proposal.status).toBe("pending");
  });

  it("rejects operations that fail validation", async () => {
    const proposalId = await propose([
      { type: "create_outcome", key: "OUT-1", title: "" },
    ]);

    await expect(applyProposal(db, proposalId, "pm")).rejects.toThrow();
    expect(await db.select().from(outcomes)).toEqual([]);
  });

  it.each<[string, GraphOperationInput, string]>([
    [
      "an outcome key",
      { type: "create_outcome", key: "OUT-1", title: "Again" },
      "Outcome key OUT-1 is in use",
    ],
    [
      "a requirement key",
      {
        type: "create_requirement",
        key: "TL-1",
        outcome_key: "OUT-1",
        title: "Again",
      },
      "Requirement key TL-1 is in use",
    ],
    [
      "a split child key",
      {
        type: "split_requirement",
        requirement_key: "TL-1",
        split_reason: "Reason",
        product_note: "Note",
        children: [
          { key: "TL-2", title: "New" },
          { key: "TL-1", title: "Clash" },
        ],
      },
      "Requirement key TL-1 is in use",
    ],
  ])("reports reusing %s as a ProposalError", async (_, op, message) => {
    await approve(exportOutcome);
    const before = await snapshot();
    const proposalId = await propose([op]);

    const result = applyProposal(db, proposalId, "pm");

    await expect(result).rejects.toThrow(ProposalError);
    await expect(result).rejects.toThrow(message);
    expect(await snapshot()).toEqual(before);
  });

  it("will not apply a proposal twice", async () => {
    const proposalId = await propose(exportOutcome);
    await applyProposal(db, proposalId, "pm");

    await expect(applyProposal(db, proposalId, "pm")).rejects.toThrow(
      ProposalError,
    );
  });
});

describe("split_requirement", () => {
  beforeEach(async () => {
    await approve([
      ...exportOutcome,
      {
        type: "split_requirement",
        requirement_key: "TL-1",
        split_reason: "Needs a job queue first",
        product_note: "Export needs background jobs, which also unblock email.",
        children: [
          { key: "TL-2", title: "Job queue", status: "done" },
          { key: "TL-3", title: "Excel writer", user_visible: true },
        ],
      },
    ]);
  });

  it("keeps the parent's link to its outcome and clears its status", async () => {
    const [outcome] = await db.select().from(outcomes);
    const tl1 = await requirementByKey("TL-1");

    expect(tl1).toMatchObject({
      outcomeId: outcome.id,
      status: null,
      splitReason: "Needs a job queue first",
    });
  });

  it("adds the children under the parent", async () => {
    const tl1 = await requirementByKey("TL-1");

    expect(await requirementByKey("TL-2")).toMatchObject({
      parentId: tl1.id,
      outcomeId: null,
      status: "done",
    });
    expect(await requirementByKey("TL-3")).toMatchObject({
      parentId: tl1.id,
      status: "planned",
      userVisible: true,
    });
  });

  it("records the product note on the event", async () => {
    const [split] = await db
      .select()
      .from(events)
      .where(eq(events.type, "split_requirement"));

    expect(split.productNote).toBe(
      "Export needs background jobs, which also unblock email.",
    );
  });

  it("stops the parent's status being set directly", async () => {
    const proposalId = await propose([
      { type: "set_status", requirement_key: "TL-1", status: "done" },
    ]);

    await expect(applyProposal(db, proposalId, "pm")).rejects.toThrow(
      "Requirement TL-1 has been split",
    );
  });
});

describe("links", () => {
  let workItemId: string;

  beforeEach(async () => {
    [{ id: workItemId }] = await db
      .insert(workItems)
      .values({
        projectId,
        source: "github",
        externalId: "4242#41",
        kind: "pull_request",
        title: "Export endpoint",
        url: "https://github.com/acme/app/pull/41",
        state: "merged",
      })
      .returning();
    await approve(exportOutcome);
  });

  const link: GraphOperationInput = {
    type: "link_work_item",
    requirement_key: "TL-1",
    work_item_id: "",
    confidence: "explicit",
  };

  it("links and unlinks a work item", async () => {
    await approve([{ ...link, work_item_id: workItemId }]);
    expect(await db.select().from(links)).toMatchObject([
      { workItemId, relation: "implements" },
    ]);

    await approve([
      {
        type: "unlink_work_item",
        requirement_key: "TL-1",
        work_item_id: workItemId,
      },
    ]);
    expect(await db.select().from(links)).toEqual([]);
  });

  it("reports linking the same work item twice as a ProposalError", async () => {
    await approve([{ ...link, work_item_id: workItemId }]);
    const proposalId = await propose([{ ...link, work_item_id: workItemId }]);

    await expect(applyProposal(db, proposalId, "pm")).rejects.toThrow(
      "TL-1 is already linked",
    );
  });
});

describe("applyProposal with edits", () => {
  it("applies the reviewer's wording and stores it on the proposal", async () => {
    const proposalId = await propose(exportOutcome);
    const edited = [
      { ...exportOutcome[0], title: "Customers can export to Excel" },
      { ...exportOutcome[1], user_visible: false, product_note: "Soon." },
    ];

    await applyProposal(db, proposalId, "pm", edited);

    const [outcome] = await db.select().from(outcomes);
    expect(outcome.title).toBe("Customers can export to Excel");
    expect(await requirementByKey("TL-1")).toMatchObject({
      userVisible: false,
      productNote: "Soon.",
    });
    const [proposal] = await db.select().from(proposals);
    expect(proposal.operations).toMatchObject(edited);
  });

  it("refuses an edit that changes what the proposal touches", async () => {
    await approve(exportOutcome);
    const before = await snapshot();
    const proposalId = await propose([
      { type: "set_status", requirement_key: "TL-1", status: "done" },
    ]);

    for (const edited of [
      [{ type: "set_status", requirement_key: "TL-2", status: "done" }],
      [
        { type: "set_status", requirement_key: "TL-1", status: "done" },
        { type: "set_status", requirement_key: "TL-1", status: "dropped" },
      ],
      [{ type: "update_requirement", requirement_key: "TL-1", title: "X" }],
    ]) {
      await expect(applyProposal(db, proposalId, "pm", edited)).rejects.toThrow(
        ProposalError,
      );
    }
    expect(await snapshot()).toEqual(before);
  });

  it("refuses an edit whose keys are crafted to look like the original", async () => {
    await approve(exportOutcome);
    const proposalId = await propose([
      {
        type: "split_requirement",
        requirement_key: "TL-1",
        split_reason: "Two parts",
        product_note: "Two parts",
        children: [
          { key: "TL-2", title: "A" },
          { key: "TL-3", title: "B" },
        ],
      },
    ]);
    await expect(
      applyProposal(db, proposalId, "pm", [
        {
          type: "split_requirement",
          requirement_key: "TL-1",
          split_reason: "Two parts",
          product_note: "Two parts",
          children: [{ key: "TL-2,TL-3", title: "A" }],
        },
      ]),
    ).rejects.toThrow(ProposalError);
  });

  it("validates edited operations", async () => {
    const proposalId = await propose(exportOutcome);
    await expect(
      applyProposal(db, proposalId, "pm", [
        { ...exportOutcome[0], title: "  " },
        exportOutcome[1],
      ]),
    ).rejects.toThrow();
    expect(await db.select().from(outcomes)).toEqual([]);
  });
});

describe("targets", () => {
  it("sets requirement targets and records an outcome move with its note", async () => {
    await approve([
      {
        type: "create_outcome",
        key: "OUT-1",
        title: "Export",
        target: "2027-Q1",
      },
      {
        type: "create_requirement",
        key: "TL-1",
        outcome_key: "OUT-1",
        title: "Async export service",
        target: "2027-02-15",
      },
    ]);
    await approve([
      {
        type: "update_requirement",
        requirement_key: "TL-1",
        target: "2027-Q2",
      },
      {
        type: "update_outcome",
        outcome_key: "OUT-1",
        target: "2027-Q2",
        product_note: "We ship SSO first.",
      },
    ]);

    expect(await requirementByKey("TL-1")).toMatchObject({
      target: "2027-Q2",
      productNote: null,
    });
    const [outcome] = await db.select().from(outcomes);
    expect(outcome.target).toBe("2027-Q2");
    const [moved] = await db
      .select()
      .from(events)
      .where(eq(events.type, "update_outcome"));
    expect(moved).toMatchObject({
      entityId: outcome.id,
      productNote: "Moved from Q1 2027 to Q2 2027. We ship SSO first.",
    });
  });

  it("describes the move from the target the outcome has when it is applied", async () => {
    await approve([
      {
        type: "create_outcome",
        key: "OUT-1",
        title: "Export",
        target: "2027-Q1",
      },
    ]);
    const move = (target: string): GraphOperationInput[] => [
      { type: "update_outcome", outcome_key: "OUT-1", target },
    ];
    const stale = await propose(move("2027-Q2"));
    // The outcome moves another way before the proposal is decided, and the reviewer edits it.
    await approve(move("2027-Q3"));
    await applyProposal(db, stale, "pm", move("2027-Q4"));

    const notes = await db
      .select({ note: events.productNote })
      .from(events)
      .where(eq(events.type, "update_outcome"))
      .orderBy(events.seq);
    expect(notes.map((row) => row.note)).toEqual([
      "Moved from Q1 2027 to Q3 2027.",
      "Moved from Q3 2027 to Q4 2027.",
    ]);
  });

  it("refuses a target that is not a quarter or a date", async () => {
    await approve(exportOutcome);
    const proposalId = await propose([
      { type: "update_outcome", outcome_key: "OUT-1", target: "next spring" },
    ]);

    await expect(applyProposal(db, proposalId, "pm")).rejects.toThrow(
      "Use a quarter like 2027-Q1",
    );
  });
});

describe("rejectProposal", () => {
  it("marks the proposal rejected and changes nothing else", async () => {
    await approve(exportOutcome);
    const before = await snapshot();
    const proposalId = await propose([
      { type: "set_status", requirement_key: "TL-1", status: "done" },
      { type: "update_outcome", outcome_key: "OUT-1", title: "Renamed" },
    ]);

    await rejectProposal(db, proposalId, "pm");

    expect(await snapshot()).toEqual(before);
    const [proposal] = await db
      .select()
      .from(proposals)
      .where(eq(proposals.id, proposalId));
    expect(proposal).toMatchObject({ status: "rejected", decidedBy: "pm" });
  });

  it("cannot be applied after rejection", async () => {
    const proposalId = await propose(exportOutcome);
    await rejectProposal(db, proposalId, "pm");

    await expect(applyProposal(db, proposalId, "pm")).rejects.toThrow(
      "is rejected, not pending",
    );
    expect(await db.select().from(outcomes)).toEqual([]);
  });
});

describe("requirements table", () => {
  it("requires exactly one of outcome_id or parent_id", async () => {
    await approve(exportOutcome);
    const tl1 = await requirementByKey("TL-1");
    const base = { projectId, title: "Orphan", status: "planned" as const };

    await expect(
      db.insert(requirements).values({ ...base, key: "TL-8" }),
    ).rejects.toThrow();
    await expect(
      db.insert(requirements).values({
        ...base,
        key: "TL-9",
        outcomeId: tl1.outcomeId,
        parentId: tl1.id,
      }),
    ).rejects.toThrow();
  });
});
