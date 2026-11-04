/** Tests for the plan page's reorder and retarget operations, and for saving them as approved proposals. */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { events, outcomes, projects, proposals } from "@/db/schema";
import { createTestDb } from "@/db/test-db";

import {
  moveOperations,
  outcomeTargetOperations,
  savePlanningChange,
} from "./planning";

const ordered = [
  { key: "OUT-1", title: "SSO", priority: 1 },
  { key: "OUT-2", title: "Bulk export", priority: 1 },
  { key: "OUT-3", title: "Alerts", priority: 2 },
];

describe("moveOperations", () => {
  it("renumbers the new order and notes only the moved outcome", () => {
    expect(moveOperations(ordered, "OUT-3", 0)).toEqual([
      {
        type: "update_outcome",
        outcome_key: "OUT-3",
        priority: 1,
        product_note: "Now comes before “SSO”.",
      },
      { type: "update_outcome", outcome_key: "OUT-1", priority: 2 },
      { type: "update_outcome", outcome_key: "OUT-2", priority: 3 },
    ]);
  });

  it("says what a moved-down outcome now follows", () => {
    expect(moveOperations(ordered, "OUT-1", 1)).toEqual([
      // OUT-2 already has priority 1, so it needs no change.
      {
        type: "update_outcome",
        outcome_key: "OUT-1",
        priority: 2,
        product_note: "Now comes after “Bulk export”.",
      },
      { type: "update_outcome", outcome_key: "OUT-3", priority: 3 },
    ]);
  });

  it("clamps positions past either end", () => {
    expect(moveOperations(ordered, "OUT-1", 99).at(-1)).toMatchObject({
      outcome_key: "OUT-1",
      priority: 3,
    });
  });

  it("changes nothing when the outcome stays put or is unknown", () => {
    expect(moveOperations(ordered, "OUT-2", 1)).toEqual([]);
    expect(moveOperations(ordered, "OUT-9", 0)).toEqual([]);
  });
});

describe("outcomeTargetOperations", () => {
  it.each([
    ["2027-Q1", "2027-Q2", "Moved from Q1 2027 to Q2 2027."],
    [null, "2027-03-31", "Now planned for 31 March 2027."],
    ["2027-Q1", null, "The target date was removed."],
  ])("notes a change from %j to %j", (before, after, note) => {
    expect(
      outcomeTargetOperations({ key: "OUT-1", target: before }, after),
    ).toEqual([
      {
        type: "update_outcome",
        outcome_key: "OUT-1",
        target: after,
        product_note: note,
      },
    ]);
  });

  it("adds the reason and skips a change to the same target", () => {
    expect(
      outcomeTargetOperations(
        { key: "OUT-1", target: "2027-Q1" },
        "2027-Q2",
        "  We ship SSO first. ",
      )[0],
    ).toMatchObject({
      product_note: "Moved from Q1 2027 to Q2 2027. We ship SSO first.",
    });
    expect(
      outcomeTargetOperations({ key: "OUT-1", target: "2027-Q1" }, "2027-Q1"),
    ).toEqual([]);
  });
});

describe("savePlanningChange", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let projectId: string;

  beforeEach(async () => {
    db = await createTestDb();
    [{ id: projectId }] = await db
      .insert(projects)
      .values({ name: "Test", slug: "test" })
      .returning();
    await db
      .insert(outcomes)
      .values({ projectId, key: "OUT-1", title: "SSO", target: "2027-Q1" });
  });

  it("applies the change through an approved manual proposal with an event", async () => {
    const proposalId = await savePlanningChange(
      db,
      projectId,
      "Move SSO to Q2 2027",
      outcomeTargetOperations({ key: "OUT-1", target: "2027-Q1" }, "2027-Q2"),
      "planner",
    );

    const [proposal] = await db
      .select()
      .from(proposals)
      .where(eq(proposals.id, proposalId));
    expect(proposal).toMatchObject({
      source: "manual",
      status: "approved",
      decidedBy: "planner",
    });
    const [outcome] = await db.select().from(outcomes);
    expect(outcome.target).toBe("2027-Q2");
    expect(await db.select().from(events)).toMatchObject([
      {
        actor: "planner",
        proposalId,
        productNote: "Moved from Q1 2027 to Q2 2027.",
      },
    ]);
  });

  it("saves nothing when the change cannot be applied", async () => {
    await expect(
      savePlanningChange(
        db,
        projectId,
        "Move",
        [{ type: "update_outcome", outcome_key: "OUT-9", priority: 1 }],
        "planner",
      ),
    ).rejects.toThrow("Outcome OUT-9 not found");
    expect(await db.$count(proposals)).toBe(0);
  });
});
