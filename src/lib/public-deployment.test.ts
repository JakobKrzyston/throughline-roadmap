/** Tests that a public deployment lets visitors change only demo projects, and never on the AI key. */
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LLMProvider } from "@/adapters/llm/provider";
import {
  jobs,
  projects,
  proposals,
  requirements,
  workItems,
} from "@/db/schema";
import { DEMO_SLUG, seedDemoProject } from "@/db/seed";
import { createTestDb } from "@/db/test-db";

type TestDb = Awaited<ReturnType<typeof createTestDb>>;

const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock(import("@/db/client"), async (importOriginal) => ({
  ...(await importOriginal()),
  getDb: () => state.db as TestDb,
}));
// Stands in for Claude and GitHub: any call means a visitor reached the owner's key or the network.
const unreachable = vi.hoisted(() => () => {
  throw new Error("Called the real service");
});
vi.mock(import("@/adapters/llm"), async (importOriginal) => ({
  ...(await importOriginal()),
  getLLMProvider: () => ({ complete: unreachable }) as unknown as LLMProvider,
}));
vi.mock(import("@/adapters/github"), async (importOriginal) => ({
  ...(await importOriginal()),
  isGitHubConfigured: () => true,
  getGitHubAdapter: () => new Proxy({}, { get: () => unreachable }) as never,
}));
// These need a Next.js request scope; what they schedule or refresh is not under test here.
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));

const { decideProposal } = await import("@/app/p/[slug]/review/actions");
const { generateImportProposal } =
  await import("@/app/p/[slug]/import/actions");
const { connectRepository } = await import("@/app/p/[slug]/settings/actions");
const { runQueuedJobs } = await import("@/jobs");

const REAL_SLUG = "throughline";
let db: TestDb;

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

async function pendingProposal(slug: string): Promise<string> {
  const [row] = await db
    .select({ id: proposals.id })
    .from(proposals)
    .innerJoin(projects, eq(proposals.projectId, projects.id))
    .where(and(eq(projects.slug, slug), eq(proposals.status, "pending")));
  return row.id;
}

beforeEach(async () => {
  vi.stubEnv("PUBLIC_DEPLOYMENT", "true");
  db = await createTestDb();
  state.db = db;
  await seedDemoProject(db);
  const [project] = await db
    .insert(projects)
    .values({ name: "Throughline", slug: REAL_SLUG })
    .returning();
  await db.insert(proposals).values({
    projectId: project.id,
    source: "import",
    summary: "Roadmap",
    operations: [{ type: "create_outcome", key: "OUT-1", title: "Ship it" }],
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("on a public deployment", () => {
  it("refuses decisions on a project that is not a demo", async () => {
    const id = await pendingProposal(REAL_SLUG);

    const result = await decideProposal(
      REAL_SLUG,
      { status: "idle" },
      form({ proposalId: id, decision: "approve" }),
    );

    expect(result).toEqual({
      status: "error",
      message: "This project is view-only on this server.",
    });
    const [row] = await db.select().from(proposals).where(eq(proposals.id, id));
    expect(row.status).toBe("pending");
  });

  it("still takes decisions on the demo project", async () => {
    const id = await pendingProposal(DEMO_SLUG);

    const result = await decideProposal(
      DEMO_SLUG,
      { status: "idle" },
      form({ proposalId: id, decision: "reject" }),
    );

    expect(result).toEqual({ status: "idle" });
    const [row] = await db.select().from(proposals).where(eq(proposals.id, id));
    expect(row.status).toBe("rejected");
  });

  it("refuses imports into a project that is not a demo", async () => {
    const result = await generateImportProposal(
      REAL_SLUG,
      { status: "idle" },
      form({ roadmap: "Ship it" }),
    );

    expect(result).toMatchObject({
      status: "error",
      message: "This project is view-only on this server.",
    });
  });

  it("imports into the demo with sample results, not the AI key", async () => {
    const result = await generateImportProposal(
      DEMO_SLUG,
      { status: "idle" },
      form({ roadmap: "Ship it" }),
    );

    expect(result).toMatchObject({ status: "success" });
  });

  it("does not let visitors connect repositories", async () => {
    const result = await connectRepository(
      DEMO_SLUG,
      { status: "idle" },
      form({ repository: "JakobKrzyston/throughline-roadmap" }),
    );

    expect(result).toMatchObject({
      status: "error",
      message: "Repositories are connected by the site owner on this server.",
    });
  });

  it("runs demo agents on sample results without looking up GitHub", async () => {
    const [item] = await db
      .select()
      .from(workItems)
      .where(
        eq(workItems.title, "Excel export: multiple sheets and formatting"),
      );
    const [requirement] = await db
      .select()
      .from(requirements)
      .where(eq(requirements.key, "TL-4"));
    await db.insert(jobs).values({
      type: "reconcile",
      payload: { workItemId: item.id, requirementId: requirement.id },
    });

    expect(await runQueuedJobs()).toEqual({ done: 1, failed: 0 });
  });
});
