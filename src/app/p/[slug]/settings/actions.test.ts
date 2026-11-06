/** Tests for connectLinearTeam: the LINEAR_ALLOWED_TEAMS allowlist and the workspace TL-team check, with a fake Linear. */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LinearIssue } from "@/adapters/linear/adapter";
import {
  FakeLinearAdapter,
  sampleLinearIssues,
} from "@/adapters/linear/fake-adapter";
import { jobs, projects, repositories } from "@/db/schema";
import { DEMO_SLUG, seedDemoProject } from "@/db/seed";
import { createTestDb } from "@/db/test-db";

type TestDb = Awaited<ReturnType<typeof createTestDb>>;

const state = vi.hoisted(() => ({
  db: undefined as unknown,
  adapter: undefined as unknown,
}));
vi.mock(import("@/db/client"), async (importOriginal) => ({
  ...(await importOriginal()),
  getDb: () => state.db as TestDb,
}));
// Linear is never called: real projects read a fake workspace. Demo projects keep the real choice.
vi.mock(import("@/adapters/linear"), async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    linearAdapterFor: (project: { isDemo: boolean }) =>
      project.isDemo
        ? original.linearAdapterFor(project)
        : (state.adapter as FakeLinearAdapter),
  };
});
// These need a Next.js request scope; what they schedule or refresh is not under test here.
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));

const { connectLinearTeam } = await import("./actions");

const IDLE = { status: "idle" } as const;
let db: TestDb;

/** A workspace with an ENG team and, optionally, a team keyed TL. */
function workspace({ tlTeam }: { tlTeam: boolean }): FakeLinearAdapter {
  const [engIssue] = sampleLinearIssues();
  const issues: LinearIssue[] = [
    { ...engIssue, team: { id: "team-eng", key: "ENG" } },
  ];
  if (tlTeam) {
    issues.push({
      ...engIssue,
      id: "tl-1",
      team: { id: "team-tl", key: "TL" },
    });
  }
  return new FakeLinearAdapter(issues);
}

function teamForm(key: string): FormData {
  const data = new FormData();
  data.set("repository", key);
  return data;
}

beforeEach(async () => {
  vi.stubEnv("PUBLIC_DEPLOYMENT", "");
  vi.stubEnv("LINEAR_ALLOWED_TEAMS", "eng, tl");
  db = await createTestDb();
  state.db = db;
  state.adapter = workspace({ tlTeam: false });
  await seedDemoProject(db);
  await db.insert(projects).values({ name: "Real", slug: "real" });
});

describe("connectLinearTeam", () => {
  it("refuses a team missing from LINEAR_ALLOWED_TEAMS before reading Linear", async () => {
    vi.stubEnv("LINEAR_ALLOWED_TEAMS", "ops");
    const lookup = vi.spyOn(
      state.adapter as FakeLinearAdapter,
      "findRepository",
    );
    const result = await connectLinearTeam("real", IDLE, teamForm("eng"));
    expect(result).toMatchObject({
      status: "error",
      message: expect.stringContaining("ENG is not one of them"),
    });
    expect(lookup).not.toHaveBeenCalled();
    expect(
      await db.$count(repositories, eq(repositories.source, "linear")),
    ).toBe(0);
  });

  it("connects a listed team and queues its import", async () => {
    const result = await connectLinearTeam("real", IDLE, teamForm("Eng"));
    expect(result.status).toBe("success");
    const [row] = await db
      .select()
      .from(repositories)
      .where(eq(repositories.source, "linear"));
    expect(row).toMatchObject({
      externalId: "team-eng",
      fullName: "ENG",
      referencesIgnored: false,
    });
    expect(await db.$count(jobs, eq(jobs.type, "backfill"))).toBe(1);
  });

  it("ignores references for any team when the workspace has a team keyed TL", async () => {
    state.adapter = workspace({ tlTeam: true });
    await connectLinearTeam("real", IDLE, teamForm("ENG"));
    await connectLinearTeam("real", IDLE, teamForm("TL"));
    const rows = await db
      .select({
        fullName: repositories.fullName,
        referencesIgnored: repositories.referencesIgnored,
      })
      .from(repositories)
      .where(eq(repositories.source, "linear"))
      .orderBy(repositories.fullName);
    expect(rows).toEqual([
      { fullName: "ENG", referencesIgnored: true },
      { fullName: "TL", referencesIgnored: true },
    ]);
  });

  it("connects the sample team to a demo project without the allowlist", async () => {
    vi.stubEnv("LINEAR_ALLOWED_TEAMS", "");
    const result = await connectLinearTeam(DEMO_SLUG, IDLE, teamForm("eng"));
    expect(result.status).toBe("success");
    expect(
      await db.$count(repositories, eq(repositories.source, "linear")),
    ).toBe(1);
  });
});
