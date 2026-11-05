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
  groupByDay,
  groupByQuarter,
  loadRecentChanges,
  loadRoadmap,
  loadSplitHistory,
  type OutcomeTree,
  quarterOf,
  type RecentChange,
  stillToCome,
} from "./roadmap";
import { productStatus, teamProgress } from "./rollup";

describe("quarterOf", () => {
  it.each([
    ["2027-Q1", "2027-Q1"],
    ["2027-01-11", "2027-Q1"],
    ["2026-12-31", "2026-Q4"],
    ["2026-07-01", "2026-Q3"],
    ["H1 2027", null],
    [null, null],
  ])("puts %s in %s", (target, quarter) => {
    expect(quarterOf(target)).toBe(quarter);
  });
});

describe("groupByQuarter", () => {
  const outcome = (key: string, target: string | null): OutcomeTree => ({
    id: key,
    key,
    title: key,
    description: "",
    target,
    priority: 0,
    requirements: [],
  });

  it("orders quarters by time, dates within a quarter by day, and undated outcomes last", () => {
    const groups = groupByQuarter([
      outcome("A", "2027-Q1"),
      outcome("B", null),
      outcome("C", "2026-Q3"),
      outcome("D", "2027-02-15"),
      outcome("E", "H1 2027"),
      outcome("F", "2027-Q1"),
      outcome("G", "2027-01-11"),
    ]);

    expect(
      groups.map((g) => [g.quarter, g.outcomes.map((o) => o.key)]),
    ).toEqual([
      ["2026-Q3", ["C"]],
      ["2027-Q1", ["G", "D", "A", "F"]],
      [null, ["B", "E"]],
    ]);
  });
});

describe("groupByDay", () => {
  const change = (id: string, at: string): RecentChange => ({
    id,
    note: id,
    at: new Date(at),
    outcomeTitle: "Export",
    entityKey: "TL-1",
    kind: "updated",
  });

  it("shows each UTC day once, newest first, keeping the order within a day", () => {
    const groups = groupByDay([
      change("c", "2026-11-04T23:30:00Z"),
      change("b", "2026-11-04T08:00:00Z"),
      change("a", "2026-11-02T12:00:00Z"),
    ]);

    expect(groups.map((g) => [g.day, g.changes.map((c) => c.id)])).toEqual([
      ["2026-11-04", ["c", "b"]],
      ["2026-11-02", ["a"]],
    ]);
  });
});

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

  it("passes a team down to pieces without their own, and gathers people from linked work", async () => {
    const roadmap = await loadRoadmap(db, projectId);
    const exportService = roadmap[0].requirements[0];
    const [queue, , , button] = exportService.children;

    expect(exportService).toMatchObject({
      workType: "feature",
      team: "Data",
      teamInherited: false,
    });
    expect(queue).toMatchObject({
      workType: "infrastructure",
      team: "Data",
      teamInherited: true,
      people: ["maya-chen", "sam-okafor"],
    });
    expect(button).toMatchObject({ team: "Web", teamInherited: false });
    // The dropped audit log is not counted.
    expect(teamProgress(roadmap[0].requirements)).toEqual([
      { team: "Data", done: 2, total: 3 },
      { team: "Web", done: 0, total: 1 },
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

  it("lists what is still to come in plain language, leaving out technical-only work", async () => {
    const roadmap = await loadRoadmap(db, projectId);
    const dashboards = roadmap.find((o) => o.key === "OUT-4")!;

    // TL-2 and TL-3 are done and TL-6 was dropped.
    expect(stillToCome(roadmap[0].requirements)).toEqual([
      { key: "TL-4", text: "Excel export" },
      { key: "TL-5", text: "Export button in report toolbar" },
    ]);
    // The cache work under TL-15 is behind the scenes and has no product note.
    expect(stillToCome(dashboards.requirements)).toEqual([
      { key: "TL-20", text: "Lazy-load dashboard widgets" },
    ]);
  });

  it("tells shipped, dropped, split, added and replanned changes apart", async () => {
    const roadmap = await loadRoadmap(db, projectId);
    const changes = await loadRecentChanges(db, projectId, roadmap);
    const kindOf = (note: string): string | undefined =>
      changes.find((c) => c.note === note)?.kind;

    expect(kindOf("Customers can now download any report as CSV.")).toBe(
      "shipped",
    );
    expect(
      kindOf(
        "Export audit log is no longer planned; no customer asked for it.",
      ),
    ).toBe("dropped");
    expect(
      kindOf(
        "Reports can be emailed; handling bounced emails is planned next.",
      ),
    ).toBe("split");
    expect(
      kindOf("Exports run in the background so large reports don't time out."),
    ).toBe("added");
    expect(
      kindOf(
        "Moved from Q1 2027 to Q2 2027. Single sign-on and exports come first.",
      ),
    ).toBe("replanned");
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
      kind: "replanned",
    });
    expect(reworded).toMatchObject({ note: "Reworded.", kind: "updated" });
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
