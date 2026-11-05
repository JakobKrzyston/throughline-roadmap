/** Tests for /api/demo/reset against an in-memory database. */
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { rejectProposal } from "@/core/proposals";
import { projects, proposals } from "@/db/schema";
import { DEMO_SLUG, seedDemoProject } from "@/db/seed";
import { createTestDb } from "@/db/test-db";

type TestDb = Awaited<ReturnType<typeof createTestDb>>;

const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock(import("@/db/client"), async (importOriginal) => ({
  ...(await importOriginal()),
  getDb: () => state.db as TestDb,
}));

const { GET } = await import("./route");

const SECRET = "cron-secret";
let db: TestDb;

function reset(authorization?: string): Promise<Response> {
  return GET(
    new Request("http://localhost/api/demo/reset", {
      headers: authorization ? { authorization } : {},
    }),
  );
}

async function pendingCount(): Promise<number> {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.slug, DEMO_SLUG));
  return db.$count(
    proposals,
    and(eq(proposals.projectId, project.id), eq(proposals.status, "pending")),
  );
}

beforeEach(async () => {
  vi.stubEnv("CRON_SECRET", SECRET);
  db = await createTestDb();
  state.db = db;
  await seedDemoProject(db);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/api/demo/reset", () => {
  it("rejects a request without the cron secret and changes nothing", async () => {
    const [before] = await db.select().from(projects);

    expect((await reset()).status).toBe(401);
    expect((await reset("Bearer wrong")).status).toBe(401);
    expect(await db.select().from(projects)).toEqual([before]);
  });

  it("stays shut when no cron secret is configured", async () => {
    vi.stubEnv("CRON_SECRET", "");

    expect((await reset("Bearer ")).status).toBe(401);
  });

  it("puts back the proposals a visitor decided", async () => {
    const [first] = await db
      .select()
      .from(proposals)
      .where(eq(proposals.status, "pending"));
    await rejectProposal(db, first.id, "reviewer");
    expect(await pendingCount()).toBe(4);

    const response = await reset(`Bearer ${SECRET}`);

    expect(response.status).toBe(200);
    expect(await pendingCount()).toBe(5);
    const [project] = await db.select().from(projects);
    expect(await response.json()).toEqual({ projectId: project.id });
  });
});
