/** Tests for the plan page's server actions against the demo seed. */
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadRoadmap, loadRecentChanges } from "@/core/roadmap";
import { outcomes, proposals, requirements } from "@/db/schema";
import { DEMO_SLUG, seedDemoProject } from "@/db/seed";
import { createTestDb } from "@/db/test-db";

type TestDb = Awaited<ReturnType<typeof createTestDb>>;

const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock(import("@/db/client"), async (importOriginal) => ({
  ...(await importOriginal()),
  getDb: () => state.db as TestDb,
}));
// Needs a Next.js request scope; what it refreshes is not under test here.
vi.mock("next/cache", () => ({ refresh: vi.fn() }));

const { moveOutcome, saveTarget } = await import("./actions");

let db: TestDb;
let projectId: string;

beforeEach(async () => {
  db = await createTestDb();
  state.db = db;
  projectId = await seedDemoProject(db);
});

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe("moveOutcome", () => {
  it("reorders the outcomes and puts the move in the change feed", async () => {
    // Demo order: OUT-1, OUT-3, OUT-2, OUT-4, OUT-5.
    expect(await moveOutcome(DEMO_SLUG, "OUT-4", 0)).toEqual({
      status: "idle",
    });

    const roadmap = await loadRoadmap(db, projectId);
    expect(roadmap.map((o) => [o.key, o.priority])).toEqual([
      ["OUT-4", 1],
      ["OUT-1", 2],
      ["OUT-3", 3],
      ["OUT-2", 4],
      ["OUT-5", 5],
    ]);
    const [latest] = await loadRecentChanges(db, projectId, roadmap);
    expect(latest).toMatchObject({
      note: "Now comes before “Customers can export reports to Excel and CSV”.",
      outcomeTitle: "Dashboards load in under two seconds",
      moved: true,
    });
    const [proposal] = await db
      .select()
      .from(proposals)
      .where(
        eq(
          proposals.summary,
          "Move “Dashboards load in under two seconds” in the priority order",
        ),
      );
    expect(proposal).toMatchObject({ source: "manual", status: "approved" });
  });

  it("refuses bad input", async () => {
    expect(await moveOutcome(DEMO_SLUG, "OUT-4", -1)).toMatchObject({
      status: "error",
    });
    expect(await moveOutcome(DEMO_SLUG, "OUT-99", 0)).toEqual({
      status: "error",
      message: "Outcome not found.",
    });
  });
});

describe("saveTarget", () => {
  const save = (fields: Record<string, string>) =>
    saveTarget(DEMO_SLUG, { status: "idle" }, form(fields));

  it("moves an outcome's target with the person's reason", async () => {
    expect(
      await save({
        kind: "outcome",
        key: "OUT-4",
        target: "2027-Q2",
        reason: "Caching took longer than planned.",
      }),
    ).toEqual({ status: "idle" });

    const roadmap = await loadRoadmap(db, projectId);
    const [latest] = await loadRecentChanges(db, projectId, roadmap);
    expect(latest).toMatchObject({
      note: "Moved from Q1 2027 to Q2 2027. Caching took longer than planned.",
      moved: true,
    });
  });

  it("sets and clears a requirement's target", async () => {
    const target = async () => {
      const [row] = await db
        .select()
        .from(requirements)
        .where(
          and(
            eq(requirements.projectId, projectId),
            eq(requirements.key, "TL-20"),
          ),
        );
      return row.target;
    };

    await save({ kind: "requirement", key: "TL-20", target: " 2027-02-01 " });
    expect(await target()).toBe("2027-02-01");
    await save({ kind: "requirement", key: "TL-20", target: "" });
    expect(await target()).toBe(null);
  });

  it("explains a target it cannot read and changes nothing", async () => {
    expect(
      await save({ kind: "outcome", key: "OUT-4", target: "next spring" }),
    ).toEqual({
      status: "error",
      message:
        "Use a quarter like 2027-Q1 or a date like 2027-01-11, or leave it empty.",
    });
    expect(
      await save({ kind: "requirement", key: "TL-404", target: "2027-Q1" }),
    ).toEqual({ status: "error", message: "Requirement TL-404 not found." });
    const [outcome] = await db
      .select()
      .from(outcomes)
      .where(and(eq(outcomes.projectId, projectId), eq(outcomes.key, "OUT-4")));
    expect(outcome.target).toBe("2027-Q1");
  });
});
