/** Tests for approveProposal against an in-memory database. */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  jobs,
  links,
  outcomes,
  projects,
  proposals,
  requirements,
  workItems,
} from "@/db/schema";
import { createTestDb } from "@/db/test-db";

import type { GraphOperationInput } from "./operations";
import { applyProposal } from "./proposals";
import { approveProposal } from "./review";

type TestDb = Awaited<ReturnType<typeof createTestDb>>;

let db: TestDb;
let projectId: string;

beforeEach(async () => {
  db = await createTestDb();
  [{ id: projectId }] = await db
    .insert(projects)
    .values({ name: "Test", slug: "test" })
    .returning();
  await applyProposal(
    db,
    await propose([
      { type: "create_outcome", key: "OUT-1", title: "Export" },
      {
        type: "create_requirement",
        key: "TL-1",
        outcome_key: "OUT-1",
        title: "CSV",
      },
    ]),
    "pm",
  );
});

async function propose(operations: GraphOperationInput[]): Promise<string> {
  const [proposal] = await db
    .insert(proposals)
    .values({ projectId, source: "link_suggest", summary: "Test", operations })
    .returning();
  return proposal.id;
}

async function pullRequest(state: "open" | "merged"): Promise<string> {
  const [row] = await db
    .insert(workItems)
    .values({
      projectId,
      source: "github",
      externalId: `4242#${state === "open" ? 1 : 2}`,
      kind: "pull_request",
      title: "Add CSV export",
      url: "https://github.com/acme/analytics/pull/1",
      state,
    })
    .returning();
  return row.id;
}

const link = (workItemId: string): GraphOperationInput[] => [
  {
    type: "link_work_item",
    requirement_key: "TL-1",
    work_item_id: workItemId,
    confidence: "suggested",
  },
];

describe("approveProposal", () => {
  it("links a merged pull request and queues its reconciliation", async () => {
    const workItemId = await pullRequest("merged");

    expect(
      await approveProposal(db, await propose(link(workItemId)), "pm"),
    ).toBe(1);

    const [tl1] = await db.select().from(requirements);
    expect(await db.select().from(links)).toMatchObject([
      { requirementId: tl1.id, workItemId, confidence: "suggested" },
    ]);
    expect(await db.select().from(jobs)).toMatchObject([
      { type: "reconcile", payload: { workItemId, requirementId: tl1.id } },
    ]);
  });

  it("queues nothing for a link to unfinished work", async () => {
    const workItemId = await pullRequest("open");
    expect(
      await approveProposal(db, await propose(link(workItemId)), "pm"),
    ).toBe(0);
    expect(await db.select().from(jobs)).toEqual([]);
  });

  it("applies the reviewer's edits", async () => {
    const workItemId = await pullRequest("open");
    const [edited] = link(workItemId);
    await approveProposal(db, await propose(link(workItemId)), "pm", [
      { ...edited, relation: "part_of" },
    ]);
    expect(await db.select().from(links)).toMatchObject([
      { relation: "part_of" },
    ]);
  });

  it("queues nothing when the proposal cannot be applied", async () => {
    const workItemId = await pullRequest("merged");
    const proposalId = await propose(link(workItemId));
    await approveProposal(db, proposalId, "pm");

    const again = await propose(link(workItemId));
    await expect(approveProposal(db, again, "pm")).rejects.toThrow(
      "already linked",
    );
    expect(await db.$count(jobs)).toBe(1);
    const [proposal] = await db
      .select()
      .from(proposals)
      .where(eq(proposals.id, again));
    expect(proposal.status).toBe("pending");
  });

  it("checks the outcome's target again after a split reconciliation", async () => {
    // Reconcile proposals record the requirement they are about; a split keeps it as the parent.
    const reconcile = async (operations: GraphOperationInput[]) => {
      const [tl1] = await db.select().from(requirements);
      const [proposal] = await db
        .insert(proposals)
        .values({
          projectId,
          source: "reconcile",
          summary: "Test",
          operations,
          requirementId: tl1.id,
        })
        .returning();
      return approveProposal(db, proposal.id, "pm");
    };

    expect(
      await reconcile([
        {
          type: "split_requirement",
          requirement_key: "TL-1",
          split_reason: "Two parts",
          product_note: "Two parts",
          children: [
            { key: "TL-2", title: "A", status: "done" },
            { key: "TL-3", title: "B" },
          ],
        },
      ]),
    ).toBe(1);
    // A check already waiting for the outcome covers the next change too.
    expect(
      await reconcile([
        {
          type: "update_requirement",
          requirement_key: "TL-1",
          title: "CSV export",
        },
      ]),
    ).toBe(0);

    const [outcome] = await db.select().from(outcomes);
    expect(await db.select().from(jobs)).toMatchObject([
      { type: "slip_check", payload: { outcomeId: outcome.id } },
    ]);
  });
});
