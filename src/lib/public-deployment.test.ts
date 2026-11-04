/** Tests that a public deployment lets visitors change only demo projects, and never on the AI key. */
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LLMProvider } from "@/adapters/llm/provider";
import { SAMPLE_IMPORT_OUTPUT } from "@/agents/fixtures";
import {
  jobs,
  outcomes,
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
const { moveOutcome, saveTarget } = await import("@/app/p/[slug]/plan/actions");
const { runQueuedJobs } = await import("@/jobs");
const { isPublicDeployment } = await import("./public-deployment");

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
  vi.unstubAllGlobals();
});

async function queueDemoReconcile(): Promise<void> {
  const [item] = await db
    .select()
    .from(workItems)
    .where(eq(workItems.title, "Excel export: multiple sheets and formatting"));
  const [requirement] = await db
    .select()
    .from(requirements)
    .where(eq(requirements.key, "TL-4"));
  await db.insert(jobs).values({
    type: "reconcile",
    payload: { workItemId: item.id, requirementId: requirement.id },
  });
}

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

  it("refuses edited approvals, even on the demo project", async () => {
    const id = await pendingProposal(DEMO_SLUG);
    const [proposal] = await db
      .select()
      .from(proposals)
      .where(eq(proposals.id, id));

    const result = await decideProposal(
      DEMO_SLUG,
      { status: "idle" },
      form({
        proposalId: id,
        decision: "approve",
        operations: JSON.stringify(proposal.operations),
      }),
    );

    expect(result).toEqual({
      status: "error",
      message:
        "Editing is turned off on this server. Approve or reject instead.",
    });
    const [row] = await db.select().from(proposals).where(eq(proposals.id, id));
    expect(row.status).toBe("pending");
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

  it("imports into the demo with the free OpenRouter model when one is set", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "or-test");
    const fetchStub = vi.fn(async () =>
      Response.json({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "roadmap_import",
                    arguments: JSON.stringify({
                      ...SAMPLE_IMPORT_OUTPUT,
                      rationale: "From the free model",
                    }),
                  },
                },
              ],
            },
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchStub);

    const result = await generateImportProposal(
      DEMO_SLUG,
      { status: "idle" },
      form({ roadmap: "Ship it" }),
    );

    expect(result).toMatchObject({ status: "success" });
    expect(fetchStub).toHaveBeenCalledOnce();
    const [proposal] = await db
      .select()
      .from(proposals)
      .where(eq(proposals.rationale, "From the free model"));
    expect(proposal).toBeDefined();
  });

  it("falls back to sample results when the free model fails", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "or-test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("rate limited", { status: 429 })),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await generateImportProposal(
      DEMO_SLUG,
      { status: "idle" },
      form({ roadmap: "Ship it" }),
    );

    expect(result).toMatchObject({ status: "success" });
  });

  it("refuses planning changes on a project that is not a demo", async () => {
    expect(await moveOutcome(REAL_SLUG, "OUT-1", "OUT-2")).toEqual({
      status: "error",
      message: "This project is view-only on this server.",
    });
  });

  it("takes target changes on the demo, but not visitors' own wording", async () => {
    const change = (fields: Record<string, string>) =>
      saveTarget(
        DEMO_SLUG,
        { status: "idle" },
        form({ kind: "outcome", key: "OUT-4", target: "2027-Q2", ...fields }),
      );

    expect(await change({ reason: "Because I said so." })).toEqual({
      status: "error",
      message: "Notes are turned off on this server. Save without one.",
    });
    expect(await change({})).toEqual({ status: "idle" });
    const [outcome] = await db
      .select()
      .from(outcomes)
      .where(eq(outcomes.key, "OUT-4"));
    expect(outcome.target).toBe("2027-Q2");
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
});

describe("demo agent jobs", () => {
  // A visitor's job can run on whichever server runs jobs next, including the owner's local app.
  it.each(["true", ""])(
    "use sample results and skip GitHub (PUBLIC_DEPLOYMENT=%j)",
    async (value) => {
      vi.stubEnv("PUBLIC_DEPLOYMENT", value);
      await queueDemoReconcile();

      expect(await runQueuedJobs()).toEqual({ done: 1, failed: 0 });
    },
  );
});

describe("isPublicDeployment", () => {
  it.each(["true", "TRUE", " true ", "1"])("is on for %j", (value) => {
    vi.stubEnv("PUBLIC_DEPLOYMENT", value);
    expect(isPublicDeployment()).toBe(true);
  });

  it.each(["", "false", "0"])("is off for %j", (value) => {
    vi.stubEnv("PUBLIC_DEPLOYMENT", value);
    expect(isPublicDeployment()).toBe(false);
  });
});
