/** Tests for the plan page's server actions against the demo seed. */
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadRoadmap, loadRecentChanges } from "@/core/roadmap";
import { jobs, outcomes, proposals, requirements } from "@/db/schema";
import { DEMO_SLUG, seedDemoProject } from "@/db/seed";
import { createTestDb } from "@/db/test-db";

type TestDb = Awaited<ReturnType<typeof createTestDb>>;

const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock(import("@/db/client"), async (importOriginal) => ({
  ...(await importOriginal()),
  getDb: () => state.db as TestDb,
}));
// These need a Next.js request scope; what they refresh or schedule is checked through the mocks.
vi.mock("next/cache", () => ({ refresh: vi.fn() }));
const after = vi.hoisted(() => vi.fn());
vi.mock("next/server", () => ({ after }));

const { moveOutcome, saveRequirement, saveTarget } = await import("./actions");

let db: TestDb;
let projectId: string;

beforeEach(async () => {
  after.mockClear();
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
    expect(await moveOutcome(DEMO_SLUG, "OUT-4", "OUT-1")).toEqual({
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
    // A reorder changes no dates, so there is nothing to check.
    expect(after).not.toHaveBeenCalled();
  });

  it("moves down to the place of the outcome it was dropped on", async () => {
    await moveOutcome(DEMO_SLUG, "OUT-1", "OUT-2");

    const roadmap = await loadRoadmap(db, projectId);
    expect(roadmap.map((o) => o.key)).toEqual([
      "OUT-3",
      "OUT-2",
      "OUT-1",
      "OUT-4",
      "OUT-5",
    ]);
  });

  it("refuses bad input", async () => {
    expect(await moveOutcome(DEMO_SLUG, "OUT-4", "")).toMatchObject({
      status: "error",
    });
    expect(await moveOutcome(DEMO_SLUG, "OUT-99", "OUT-1")).toEqual({
      status: "error",
      message: "Outcome not found.",
    });
    expect(await moveOutcome(DEMO_SLUG, "OUT-4", "OUT-99")).toEqual({
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
    // The new target is checked against the outcome's work after the response.
    expect(await db.select().from(jobs)).toMatchObject([
      { type: "slip_check", status: "queued" },
    ]);
    expect(after).toHaveBeenCalledOnce();
  });

  it("explains a target it cannot read and changes nothing", async () => {
    expect(await save({ key: "OUT-4", target: "next spring" })).toEqual({
      status: "error",
      message:
        "Use a quarter like 2027-Q1 or a date like 2027-01-11, or leave it empty.",
    });
    expect(await save({ key: "OUT-404", target: "2027-Q1" })).toEqual({
      status: "error",
      message: "Outcome not found.",
    });
    const [outcome] = await db
      .select()
      .from(outcomes)
      .where(and(eq(outcomes.projectId, projectId), eq(outcomes.key, "OUT-4")));
    expect(outcome.target).toBe("2027-Q1");
  });
});

describe("saveRequirement", () => {
  // TL-3 is a piece of TL-1, which the Data team owns. It starts with no target and no team of its own.
  const save = (fields: Record<string, string>) =>
    saveRequirement(
      DEMO_SLUG,
      { status: "idle" },
      form({
        key: "TL-3",
        target: "",
        work_type: "feature",
        team: "",
        ...fields,
      }),
    );
  const requirement = async (key: string) => {
    const [row] = await db
      .select()
      .from(requirements)
      .where(
        and(eq(requirements.projectId, projectId), eq(requirements.key, key)),
      );
    return row;
  };
  const savedOperations = async (summary: string) =>
    (
      await db
        .select({ operations: proposals.operations })
        .from(proposals)
        .where(eq(proposals.summary, summary))
    ).map((row) => row.operations);

  it("saves the target, kind of work and team in one change, and only what changed", async () => {
    expect(
      await save({
        target: " 2027-02-01 ",
        work_type: "tech_debt",
        team: " Web ",
      }),
    ).toEqual({ status: "idle" });
    expect(await requirement("TL-3")).toMatchObject({
      target: "2027-02-01",
      workType: "tech_debt",
      team: "Web",
    });
    expect(
      await savedOperations("Set TL-3's target, kind of work and team"),
    ).toEqual([
      [
        {
          type: "update_requirement",
          requirement_key: "TL-3",
          target: "2027-02-01",
          work_type: "tech_debt",
          team: "Web",
        },
      ],
    ]);
    // A new target means the outcome's schedule is checked again.
    expect(after).toHaveBeenCalledOnce();

    // Clearing the target and team: the parent's team applies again.
    await save({ target: "", work_type: "tech_debt", team: "" });
    expect(await savedOperations("Set TL-3's target and team")).toEqual([
      [
        {
          type: "update_requirement",
          requirement_key: "TL-3",
          target: null,
          team: null,
        },
      ],
    ]);
    const roadmap = await loadRoadmap(db, projectId);
    expect(roadmap[0].requirements[0].children[1]).toMatchObject({
      key: "TL-3",
      target: null,
      team: "Data",
      teamInherited: true,
    });
  });

  it("records nothing when saved unchanged, and refuses bad input", async () => {
    const before = await db.$count(proposals);
    expect(
      await save({
        key: "TL-10",
        target: "2027-Q2",
        work_type: "infrastructure",
      }),
    ).toEqual({ status: "idle" });
    expect(await db.$count(proposals)).toBe(before);

    expect(await save({ work_type: "chores" })).toMatchObject({
      status: "error",
    });
    expect(await save({ target: "next spring" })).toEqual({
      status: "error",
      message:
        "Use a quarter like 2027-Q1 or a date like 2027-01-11, or leave it empty.",
    });
    expect(await save({ team: "x".repeat(61) })).toEqual({
      status: "error",
      message: "Keep the team name to 60 characters.",
    });
    expect(await save({ key: "TL-404" })).toEqual({
      status: "error",
      message: "Requirement TL-404 not found.",
    });
    expect(await db.$count(proposals)).toBe(before);
  });

  it("changes the kind of work but not team names on a public deployment", async () => {
    vi.stubEnv("PUBLIC_DEPLOYMENT", "true");
    try {
      expect(await save({ work_type: "research", team: "Anything" })).toEqual({
        status: "error",
        message: "Team names are turned off on this server.",
      });
      expect(await save({ work_type: "tech_debt" })).toEqual({
        status: "idle",
      });
      expect(await requirement("TL-3")).toMatchObject({
        workType: "tech_debt",
        team: null,
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
