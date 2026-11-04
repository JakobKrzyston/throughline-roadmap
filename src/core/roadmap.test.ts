/** Tests for the product and technical view loaders, against the Acme Analytics demo seed. */
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { outcomes, proposals } from "@/db/schema";
import { seedDemoProject } from "@/db/seed";
import { createTestDb } from "@/db/test-db";

import type { GraphOperationInput } from "./operations";
import { applyProposal } from "./proposals";
import {
  availableToday,
  loadRecentChanges,
  loadRoadmap,
  loadSplitHistory,
} from "./roadmap";
import { productStatus } from "./rollup";

describe("roadmap loaders", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let projectId: string;

  beforeAll(async () => {
    db = await createTestDb();
    projectId = await seedDemoProject(db);
  });

  async function approve(operations: GraphOperationInput[]): Promise<void> {
    const [proposal] = await db
      .insert(proposals)
      .values({ projectId, source: "reconcile", summary: "test", operations })
      .returning();
    await applyProposal(db, proposal.id, "pm");
  }

  it("orders outcomes by priority, then key, and nests requirements by key", async () => {
    const roadmap = await loadRoadmap(db, projectId);

    expect(roadmap.map((o) => o.key)).toEqual([
      "OUT-1",
      "OUT-3",
      "OUT-2",
      "OUT-4",
      "OUT-5",
    ]);
    const exportOutcome = roadmap[0];
    expect(exportOutcome.requirements.map((r) => r.key)).toEqual([
      "TL-1",
      "TL-6",
    ]);
    expect(exportOutcome.requirements[0].children.map((r) => r.key)).toEqual([
      "TL-2",
      "TL-3",
      "TL-4",
      "TL-5",
    ]);
    expect(productStatus(exportOutcome.requirements)).toBe(
      "partially_available",
    );
  });

  it("attaches linked work items to their requirement, by number", async () => {
    const roadmap = await loadRoadmap(db, projectId);
    const queue = roadmap[0].requirements[0].children[0];

    expect(queue.workItems).toMatchObject([
      { number: "102", kind: "pull_request", state: "merged" },
      { number: "103", kind: "pull_request", state: "merged" },
    ]);
  });

  it("lists what customers can use, preferring the note written when it was finished", async () => {
    const roadmap = await loadRoadmap(db, projectId);
    const sso = roadmap.find((o) => o.key === "OUT-3")!;

    expect(availableToday(roadmap[0].requirements)).toEqual([
      { key: "TL-3", text: "Customers can now download any report as CSV." },
    ]);
    expect(availableToday(sso.requirements)).toEqual([
      { key: "TL-12", text: "SAML login" },
      { key: "TL-13", text: "SCIM user provisioning" },
      {
        key: "TL-14",
        text: "Single sign-on is ready for every enterprise customer.",
      },
    ]);
  });

  it("feeds recent product notes with the outcome they belong to", async () => {
    const roadmap = await loadRoadmap(db, projectId);
    const changes = await loadRecentChanges(
      db,
      projectId,
      roadmap,
      new Date(Date.now() - 60_000),
    );

    expect(changes).toContainEqual(
      expect.objectContaining({
        note: "Customers can now download any report as CSV.",
        outcomeTitle: "Customers can export reports to Excel and CSV",
        entityKey: "TL-3",
      }),
    );
    // TL-16 is a child of TL-15, so the walk has to go up two levels.
    expect(changes).toContainEqual(
      expect.objectContaining({
        entityKey: "TL-16",
        outcomeTitle: "Dashboards load in under two seconds",
      }),
    );
    expect(
      await loadRecentChanges(
        db,
        projectId,
        roadmap,
        new Date(Date.now() + 60_000),
      ),
    ).toEqual([]);
  });

  it("marks changes that moved an outcome's target or priority", async () => {
    await approve([
      {
        type: "update_outcome",
        outcome_key: "OUT-4",
        target: "2027-Q2",
      },
      {
        type: "update_outcome",
        outcome_key: "OUT-4",
        description: "Large accounts see their dashboards without waiting.",
        product_note: "Reworded.",
      },
    ]);

    const roadmap = await loadRoadmap(db, projectId);
    const [reworded, moved] = await loadRecentChanges(db, projectId, roadmap);
    expect(moved).toMatchObject({
      note: "Moved from Q1 2027 to Q2 2027.",
      entityKey: "OUT-4",
      outcomeTitle: "Dashboards load in under two seconds",
      moved: true,
    });
    expect(reworded).toMatchObject({ note: "Reworded.", moved: false });
  });

  it("carries requirement targets into the tree", async () => {
    await approve([
      {
        type: "update_requirement",
        requirement_key: "TL-20",
        target: "2027-Q3",
      },
    ]);

    const roadmap = await loadRoadmap(db, projectId);
    const dashboards = roadmap.find((o) => o.key === "OUT-4")!;
    expect(dashboards.requirements.map((r) => [r.key, r.target])).toEqual([
      ["TL-15", null],
      ["TL-20", "2027-Q3"],
    ]);
  });

  it("lists every split with its reason and children", async () => {
    const splits = await loadSplitHistory(
      db,
      projectId,
      await loadRoadmap(db, projectId),
    );

    expect(splits.map((s) => s.requirementKey).sort()).toEqual([
      "TL-1",
      "TL-15",
      "TL-16",
      "TL-8",
    ]);
    expect(splits.find((s) => s.requirementKey === "TL-8")).toMatchObject({
      requirementTitle: "Email delivery service",
      reason:
        "Bounce and retry handling is a separate piece of work from sending.",
      children: [
        { key: "TL-9", title: "Email provider integration" },
        { key: "TL-10", title: "Retry and bounce handling" },
      ],
    });
  });

  it("orders events from one proposal by when they were written", async () => {
    // One proposal, so all three events share a timestamp.
    await approve([
      {
        type: "set_status",
        requirement_key: "TL-4",
        status: "done",
        product_note: "Excel export is ready.",
      },
      {
        type: "set_status",
        requirement_key: "TL-4",
        status: "in_progress",
        product_note: "Excel export needs more work.",
      },
      {
        type: "set_status",
        requirement_key: "TL-4",
        status: "done",
        product_note: "Customers can download reports as Excel files.",
      },
    ]);

    const roadmap = await loadRoadmap(db, projectId);
    expect(availableToday(roadmap[0].requirements)).toContainEqual({
      key: "TL-4",
      text: "Customers can download reports as Excel files.",
    });
    const changes = await loadRecentChanges(db, projectId, roadmap);
    expect(changes.slice(0, 3).map((c) => c.note)).toEqual([
      "Customers can download reports as Excel files.",
      "Excel export needs more work.",
      "Excel export is ready.",
    ]);
  });

  it("does not reuse an earlier note when a leaf is finished again without one", async () => {
    await approve([
      { type: "set_status", requirement_key: "TL-4", status: "in_progress" },
      { type: "set_status", requirement_key: "TL-4", status: "done" },
    ]);

    const roadmap = await loadRoadmap(db, projectId);
    expect(availableToday(roadmap[0].requirements)).toContainEqual({
      key: "TL-4",
      text: "Excel export",
    });
  });

  it("hides archived outcomes from the roadmap, the feed and split history", async () => {
    await db
      .update(outcomes)
      .set({ archived: true })
      .where(and(eq(outcomes.projectId, projectId), eq(outcomes.key, "OUT-4")));

    const roadmap = await loadRoadmap(db, projectId);
    const changes = await loadRecentChanges(db, projectId, roadmap);
    const splits = await loadSplitHistory(db, projectId, roadmap);

    expect(roadmap.map((o) => o.key)).not.toContain("OUT-4");
    expect(changes.map((c) => c.entityKey)).not.toContain("TL-16");
    expect(splits.map((s) => s.requirementKey).sort()).toEqual([
      "TL-1",
      "TL-8",
    ]);
  });
});
