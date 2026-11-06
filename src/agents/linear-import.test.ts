/** Tests for the Linear roadmap import: target mapping, the initiative/project mapping and the saved proposal. */
import { beforeEach, describe, expect, it } from "vitest";

import { FakeLinearSource } from "@/adapters/linear/fake";
import {
  LinearError,
  type LinearInitiative,
  type LinearProject,
  type LinearSource,
} from "@/adapters/linear/source";
import { operationListSchema } from "@/core/operations";
import { applyProposal } from "@/core/proposals";
import { outcomes, projects, proposals, requirements } from "@/db/schema";
import { createTestDb } from "@/db/test-db";

import { linearTarget, planFromLinear, runLinearImport } from "./linear-import";

type TestDb = Awaited<ReturnType<typeof createTestDb>>;

const TEAM = { id: "team-1", name: "Product" };

function initiative(
  id: string,
  overrides: Partial<LinearInitiative> = {},
): LinearInitiative {
  return {
    id,
    name: `Initiative ${id}`,
    description: "",
    status: "Planned",
    targetDate: null,
    targetDateResolution: null,
    priority: 0,
    sortOrder: 0,
    ...overrides,
  };
}

function project(
  id: string,
  overrides: Partial<LinearProject> = {},
): LinearProject {
  return {
    id,
    name: `Project ${id}`,
    description: "",
    status: "planned",
    targetDate: null,
    targetDateResolution: null,
    priority: 0,
    sortOrder: 0,
    initiatives: [],
    teams: [TEAM],
    ...overrides,
  };
}

describe("linearTarget", () => {
  it.each([
    [null, null, null],
    ["2027-05-14", null, "2027-05-14"],
    ["2027-05-01", "month", "2027-Q2"],
    ["2027-07-01", "quarter", "2027-Q3"],
    ["2027-09-30", "quarter", "2027-Q3"],
    ["2027-01-01", "halfYear", "2027-Q2"],
    ["2027-06-30", "halfYear", "2027-Q2"],
    ["2027-07-01", "halfYear", "2027-Q4"],
    ["2027-01-01", "year", "2027-Q4"],
  ] as const)("maps %s at %s resolution to %s", (date, resolution, target) => {
    expect(linearTarget(date, resolution)).toBe(target);
  });
});

describe("planFromLinear", () => {
  it("makes each initiative an outcome and its projects requirements", () => {
    const mobile = initiative("i1", {
      name: "Dashboards on the go",
      description: "Check dashboards from a phone.",
      targetDate: "2027-06-30",
      targetDateResolution: "quarter",
    });
    const plan = planFromLinear(TEAM, [
      project("p1", {
        name: "Mobile viewer",
        description: "Read-only dashboards.",
        targetDate: "2027-05-14",
        initiatives: [mobile],
      }),
      project("p2", { name: "Push alerts", initiatives: [mobile] }),
    ]);

    expect(plan?.outcomes).toEqual([
      {
        title: "Dashboards on the go",
        description: "Check dashboards from a phone.",
        target: "2027-Q2",
        priority: 1,
        requirements: [
          {
            title: "Mobile viewer",
            description: "Read-only dashboards.",
            user_visible: false,
            work_type: null,
            product_note: null,
            target: "2027-05-14",
            team: "Product",
          },
          expect.objectContaining({ title: "Push alerts", target: null }),
        ],
      },
    ]);
  });

  it("gives a project in no initiative an outcome of its own, after the initiatives", () => {
    const plan = planFromLinear(TEAM, [
      project("p1", {
        name: "Template gallery",
        description: "Start from a template.",
        targetDate: "2027-01-01",
        targetDateResolution: "halfYear",
        priority: 1,
      }),
      project("p2", { initiatives: [initiative("i1", { priority: 4 })] }),
    ]);

    expect(plan?.outcomes.map((outcome) => outcome.title)).toEqual([
      "Initiative i1",
      "Template gallery",
    ]);
    expect(plan?.outcomes[1]).toMatchObject({
      description: "Start from a template.",
      target: "2027-Q2",
      priority: 2,
      requirements: [{ title: "Template gallery", target: "2027-Q2" }],
    });
    expect(plan?.rationale).toContain(
      "1 project in no initiative became an outcome of its own.",
    );
  });

  it("orders by Linear priority, with no priority last, then Linear's order", () => {
    const plan = planFromLinear(TEAM, [
      project("a", { initiatives: [initiative("none", { priority: 0 })] }),
      project("b", {
        initiatives: [initiative("low-second", { priority: 4, sortOrder: 2 })],
      }),
      project("c", {
        initiatives: [initiative("low-first", { priority: 4, sortOrder: 1 })],
      }),
      project("d", { initiatives: [initiative("urgent", { priority: 1 })] }),
    ]);

    expect(
      plan?.outcomes.map((outcome) => [outcome.title, outcome.priority]),
    ).toEqual([
      ["Initiative urgent", 1],
      ["Initiative low-first", 2],
      ["Initiative low-second", 3],
      ["Initiative none", 4],
    ]);
  });

  it("puts a project in several initiatives under the highest-priority one only", () => {
    const plan = planFromLinear(TEAM, [
      project("p1", {
        initiatives: [
          initiative("high", { priority: 3 }),
          initiative("urgent", { priority: 1 }),
        ],
      }),
    ]);

    expect(plan?.outcomes).toHaveLength(1);
    expect(plan?.outcomes[0].title).toBe("Initiative urgent");
    expect(plan?.rationale).toContain(
      "1 project in more than one initiative is under the highest-priority one.",
    );
  });

  it("leaves out completed and canceled projects and canceled initiatives", () => {
    const plan = planFromLinear(TEAM, [
      project("done", { status: "completed" }),
      project("dropped", { status: "canceled" }),
      project("paused", { status: "paused" }),
      project("orphan", {
        name: "Orphan",
        initiatives: [initiative("gone", { status: "Canceled" })],
      }),
    ]);

    expect(plan?.outcomes.map((outcome) => outcome.title)).toEqual([
      "Project paused",
      "Orphan",
    ]);
    expect(plan?.rationale).toContain(
      "Left out 2 completed or canceled projects.",
    );
  });

  it("names open projects whose initiatives are all canceled apart from those in none", () => {
    const plan = planFromLinear(TEAM, [
      project("loose"),
      project("orphan", {
        initiatives: [initiative("gone", { status: "Canceled" })],
      }),
    ]);

    expect(plan?.outcomes).toHaveLength(2);
    expect(plan?.rationale).toContain(
      "1 project in no initiative became an outcome of its own.",
    );
    expect(plan?.rationale).toContain(
      "1 open project whose initiatives are all canceled became an outcome of its own; leave it out if the work was dropped with the initiative.",
    );
  });

  it("flags projects shared with other teams, which their imports propose again", () => {
    const platform = { id: "team-2", name: "Platform" };
    const data = { id: "team-3", name: "Data" };
    const plan = planFromLinear(TEAM, [
      project("mine"),
      project("shared-1", { teams: [TEAM, platform] }),
      project("shared-2", { teams: [data, TEAM, platform] }),
    ]);

    expect(plan?.outcomes).toHaveLength(3);
    expect(plan?.rationale).toContain(
      "2 projects are shared with Data, Platform. Importing those teams proposes them again, so approve them only once.",
    );
    expect(planFromLinear(TEAM, [project("mine")])?.rationale).not.toContain(
      "shared",
    );
  });

  it("returns null when nothing is left to import", () => {
    expect(planFromLinear(TEAM, [])).toBeNull();
    expect(
      planFromLinear(TEAM, [project("done", { status: "completed" })]),
    ).toBeNull();
  });

  it("maps the sample workspace with valid targets and no ids in titles", async () => {
    const linear = new FakeLinearSource();
    for (const team of await linear.listTeams()) {
      const { projects: read } = await linear.readTeamProjects(team.id);
      const plan = planFromLinear(team, read)!;
      const titles = plan.outcomes.flatMap((outcome) => [
        outcome.title,
        ...outcome.requirements.map((requirement) => requirement.title),
      ]);
      expect(titles.join(" ")).not.toMatch(/sample-|[A-Z]+-\d+/);
    }
  });
});

describe("runLinearImport", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  async function createProject(): Promise<string> {
    const [created] = await db
      .insert(projects)
      .values({ name: "Test", slug: "test" })
      .returning();
    return created.id;
  }

  it("saves the sample Product team as one pending proposal that applies cleanly", async () => {
    const projectId = await createProject();

    const { proposalId, summary } = await runLinearImport(
      db,
      new FakeLinearSource(),
      projectId,
      "sample-team-product",
    );

    expect(summary).toBe(
      "Import 3 outcomes and 6 requirements from the Linear team Product",
    );
    const [proposal] = await db.select().from(proposals);
    expect(proposal).toMatchObject({
      id: proposalId,
      source: "import",
      status: "pending",
    });
    expect(proposal.rationale).toContain("1 project is shared with Platform.");
    const operations = operationListSchema.parse(proposal.operations);
    expect(
      operations.map((op) => [op.type, "key" in op ? op.key : null]),
    ).toEqual([
      ["create_outcome", "OUT-1"],
      ["create_requirement", "TL-1"],
      ["create_requirement", "TL-2"],
      ["create_requirement", "TL-3"],
      ["create_outcome", "OUT-2"],
      ["create_requirement", "TL-4"],
      ["create_requirement", "TL-5"],
      ["create_outcome", "OUT-3"],
      ["create_requirement", "TL-6"],
    ]);

    await applyProposal(db, proposalId, "pm");
    expect(
      (await db.select().from(outcomes)).map((outcome) => [
        outcome.title,
        outcome.target,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ["Dashboards on the go", "2027-Q2"],
        ["Dark mode", "2027-Q1"],
        ["Dashboard template gallery", "2027-Q2"],
      ]),
    );
    const created = await db.select().from(requirements);
    expect(created).toHaveLength(6);
    expect(created.every((requirement) => requirement.team === "Product")).toBe(
      true,
    );
    expect(
      created.find((r) => r.title === "Mobile dashboard viewer"),
    ).toMatchObject({
      target: "2027-05-14",
      status: "planned",
    });
  });

  it("saves nothing when Linear fails", async () => {
    const projectId = await createProject();
    const failing: LinearSource = {
      listTeams: async () => [],
      readTeamProjects: async () => {
        throw new LinearError("Linear did not accept the API key.");
      },
    };

    await expect(
      runLinearImport(db, failing, projectId, "team-1"),
    ).rejects.toThrow("Linear did not accept the API key.");
    expect(await db.select().from(proposals)).toEqual([]);
  });

  it("explains a team with no open projects and saves nothing", async () => {
    const projectId = await createProject();
    const finished: LinearSource = {
      listTeams: async () => [TEAM],
      readTeamProjects: async () => ({
        team: TEAM,
        projects: [project("done", { status: "completed" })],
      }),
    };

    await expect(
      runLinearImport(db, finished, projectId, TEAM.id),
    ).rejects.toThrow(
      "The Linear team Product has no open projects to import.",
    );
    expect(await db.select().from(proposals)).toEqual([]);
  });

  it("says when the sample team does not exist", async () => {
    const projectId = await createProject();
    await expect(
      runLinearImport(db, new FakeLinearSource(), projectId, "missing"),
    ).rejects.toThrow(LinearError);
  });
});
