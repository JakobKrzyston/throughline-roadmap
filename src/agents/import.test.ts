/** Tests for the roadmap import agent, using the fake LLM provider and an in-memory database. */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { FakeLLMProvider } from "@/adapters/llm/fake";
import { LLMOutputError } from "@/adapters/llm/provider";
import { operationListSchema } from "@/core/operations";
import { applyProposal } from "@/core/proposals";
import { outcomes, projects, proposals, requirements } from "@/db/schema";
import { seedDemoProject } from "@/db/seed";
import { createTestDb } from "@/db/test-db";

import { SAMPLE_IMPORT_OUTPUT, SAMPLE_ROADMAP } from "./fixtures";
import { IMPORT_TASK, runImport } from "./import";

type TestDb = Awaited<ReturnType<typeof createTestDb>>;

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
});

async function createProject(): Promise<string> {
  const [project] = await db
    .insert(projects)
    .values({ name: "Test", slug: "test" })
    .returning();
  return project.id;
}

function fakeLLM(...outputs: unknown[]): FakeLLMProvider {
  return new FakeLLMProvider({ [IMPORT_TASK]: outputs });
}

describe("runImport", () => {
  it("turns the sample roadmap into valid create operations", async () => {
    const projectId = await createProject();
    const llm = fakeLLM(SAMPLE_IMPORT_OUTPUT);

    const { proposalId, summary } = await runImport(
      db,
      llm,
      projectId,
      SAMPLE_ROADMAP,
    );

    expect(llm.prompts[0].user).toContain(SAMPLE_ROADMAP);
    expect(summary).toBe(
      "Import 2 outcomes and 5 requirements from a pasted roadmap",
    );
    const [proposal] = await db
      .select()
      .from(proposals)
      .where(eq(proposals.id, proposalId));
    expect(proposal).toMatchObject({ source: "import", status: "pending" });

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
    ]);
    expect(operations[5]).toMatchObject({
      outcome_key: "OUT-2",
      title: "Anomaly detection job",
      user_visible: false,
    });
  });

  it("produces a proposal that applies cleanly", async () => {
    const projectId = await createProject();
    const { proposalId } = await runImport(
      db,
      fakeLLM(SAMPLE_IMPORT_OUTPUT),
      projectId,
      SAMPLE_ROADMAP,
    );

    await applyProposal(db, proposalId, "pm");

    expect(await db.select().from(outcomes)).toHaveLength(2);
    const created = await db.select().from(requirements);
    expect(created).toHaveLength(5);
    expect(created.every((r) => r.status === "planned")).toBe(true);
  });

  it("numbers keys after those in the graph and in pending proposals", async () => {
    // The demo project has OUT-1..5 and TL-1..22 applied, and OUT-6, TL-23 and TL-24 pending.
    const projectId = await seedDemoProject(db);
    const { proposalId } = await runImport(
      db,
      fakeLLM(SAMPLE_IMPORT_OUTPUT),
      projectId,
      SAMPLE_ROADMAP,
    );

    const [proposal] = await db
      .select()
      .from(proposals)
      .where(eq(proposals.id, proposalId));
    const keys = proposal.operations.map((op) => ("key" in op ? op.key : null));
    expect(keys).toEqual([
      "OUT-7",
      "TL-25",
      "TL-26",
      "TL-27",
      "OUT-8",
      "TL-28",
      "TL-29",
    ]);
  });

  it("retries invalid output once, then saves nothing and raises a clear error", async () => {
    const projectId = await createProject();
    const invalid = { rationale: "Nothing found", outcomes: [] };
    const llm = fakeLLM(invalid, invalid);

    await expect(runImport(db, llm, projectId, SAMPLE_ROADMAP)).rejects.toThrow(
      LLMOutputError,
    );

    expect(llm.prompts).toHaveLength(2);
    expect(await db.select().from(proposals)).toEqual([]);
  });

  it("accepts output that is fixed on the retry", async () => {
    const projectId = await createProject();
    const llm = fakeLLM({ outcomes: "not a list" }, SAMPLE_IMPORT_OUTPUT);

    await runImport(db, llm, projectId, SAMPLE_ROADMAP);

    expect(await db.select().from(proposals)).toHaveLength(1);
  });
});
