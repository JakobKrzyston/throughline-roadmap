/** Tests for runQueuedJobs choosing whose jobs to run, against an in-memory database with no keys. */
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { jobs, outcomes, projects } from "@/db/schema";
import { seedDemoProject } from "@/db/seed";
import { createTestDb } from "@/db/test-db";

import { enqueueSlipCheck } from "./queue";

type TestDb = Awaited<ReturnType<typeof createTestDb>>;

const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock(import("@/db/client"), async (importOriginal) => ({
  ...(await importOriginal()),
  getDb: () => state.db as TestDb,
}));

const { runQueuedJobs } = await import("./index");

let db: TestDb;
let demoJob: string;
let privateJob: string;

async function statusOf(id: string): Promise<string> {
  const [row] = await db.select().from(jobs).where(eq(jobs.id, id));
  return row.status;
}

beforeEach(async () => {
  // No model or GitHub credentials, so nothing calls a real API.
  for (const name of [
    "ANTHROPIC_API_KEY",
    "OPENROUTER_API_KEY",
    "GITHUB_APP_ID",
    "GITHUB_APP_PRIVATE_KEY",
  ]) {
    vi.stubEnv(name, "");
  }
  db = await createTestDb();
  state.db = db;

  const demoId = await seedDemoProject(db);
  const [demoOutcome] = await db
    .select({ id: outcomes.id })
    .from(outcomes)
    .where(eq(outcomes.projectId, demoId))
    .limit(1);
  const [project] = await db
    .insert(projects)
    .values({ name: "Private", slug: "private" })
    .returning();
  const [privateOutcome] = await db
    .insert(outcomes)
    .values({ projectId: project.id, key: "OUT-1", title: "Export" })
    .returning();

  await enqueueSlipCheck(db, demoId, { outcomeId: demoOutcome.id });
  await enqueueSlipCheck(db, project.id, { outcomeId: privateOutcome.id });
  const ids = async (projectId: string) =>
    (
      await db
        .select({ id: jobs.id })
        .from(jobs)
        .where(and(eq(jobs.projectId, projectId), eq(jobs.status, "queued")))
    ).map((row) => row.id);
  [demoJob] = await ids(demoId);
  [privateJob] = await ids(project.id);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("runQueuedJobs", () => {
  it("on a public deployment, runs the demo's job and leaves another project's queued", async () => {
    vi.stubEnv("PUBLIC_DEPLOYMENT", "true");

    await runQueuedJobs();

    expect(await statusOf(demoJob)).toBe("done");
    const [untouched] = await db
      .select()
      .from(jobs)
      .where(eq(jobs.id, privateJob));
    expect(untouched).toMatchObject({ status: "queued", attempts: 0 });
  });

  it("elsewhere, runs every project's jobs", async () => {
    vi.stubEnv("PUBLIC_DEPLOYMENT", "");

    await runQueuedJobs();

    expect(await statusOf(demoJob)).toBe("done");
    expect(await statusOf(privateJob)).toBe("done");
  });
});
