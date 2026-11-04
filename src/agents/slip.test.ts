/** Tests for the slip check against the demo seed, with the fake LLM provider. */
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { FakeLLMProvider } from "@/adapters/llm/fake";
import { LLMOutputError } from "@/adapters/llm/provider";
import type { GraphOperationInput } from "@/core/operations";
import { applyProposal } from "@/core/proposals";
import { outcomes, proposals } from "@/db/schema";
import { seedDemoProject } from "@/db/seed";
import { createTestDb } from "@/db/test-db";

import { loadSlipContext, runSlipCheck, SLIP_TASK } from "./slip";

type TestDb = Awaited<ReturnType<typeof createTestDb>>;

let db: TestDb;
let projectId: string;

// Before every demo target, so only late requirements count as warning signs.
const TODAY = "2026-11-04";

beforeEach(async () => {
  db = await createTestDb();
  projectId = await seedDemoProject(db);
});

function fakeLLM(...outputs: unknown[]): FakeLLMProvider {
  return new FakeLLMProvider({ [SLIP_TASK]: outputs });
}

const move = (newTarget: string | null) => ({
  new_target: newTarget,
  summary: "Move scheduled email reports to Q2 2027",
  rationale: "Bounce handling is planned for Q2 2027.",
  reason: "Handling bounced emails turned out to be its own piece of work.",
});

async function outcomeId(key: string): Promise<string> {
  const [row] = await db
    .select({ id: outcomes.id })
    .from(outcomes)
    .where(and(eq(outcomes.projectId, projectId), eq(outcomes.key, key)));
  return row.id;
}

async function approve(operations: GraphOperationInput[]): Promise<void> {
  const [proposal] = await db
    .insert(proposals)
    .values({ projectId, source: "manual", summary: "test", operations })
    .returning();
  await applyProposal(db, proposal.id, "pm");
}

async function pendingReschedules() {
  return db
    .select()
    .from(proposals)
    .where(
      and(eq(proposals.source, "reschedule"), eq(proposals.status, "pending")),
    );
}

describe("loadSlipContext", () => {
  it("flags open work due after the outcome's target", async () => {
    // The seed plans retry and bounce handling (TL-10) for Q2, after scheduled reports' Q1 target.
    const context = await loadSlipContext(db, await outcomeId("OUT-2"), TODAY);

    expect(context).toMatchObject({
      outcome: { key: "OUT-2", target: "2027-Q1" },
      late: [
        { key: "TL-10", title: "Retry and bounce handling", target: "2027-Q2" },
      ],
      passed: false,
    });
  });

  it("flags a target that has passed with work still open", async () => {
    const context = await loadSlipContext(
      db,
      await outcomeId("OUT-1"),
      "2027-01-15",
    );
    expect(context).toMatchObject({ late: [], passed: true });
  });

  it("finds nothing to ask about without a warning sign", async () => {
    // Export's target is Q4 2026 and none of its work has a later date.
    expect(await loadSlipContext(db, await outcomeId("OUT-1"), TODAY)).toBe(
      null,
    );
    // Single sign-on is delivered, so a passed target does not matter.
    expect(
      await loadSlipContext(db, await outcomeId("OUT-3"), "2027-06-01"),
    ).toBe(null);
  });
});

describe("runSlipCheck", () => {
  it("proposes the new target with a plain-language note, superseding older ones", async () => {
    const [older] = await pendingReschedules();
    const llm = fakeLLM(move("2027-Q2"));

    const proposalId = await runSlipCheck(
      db,
      llm,
      await outcomeId("OUT-2"),
      TODAY,
    );

    const [proposal] = await db
      .select()
      .from(proposals)
      .where(eq(proposals.id, proposalId!));
    expect(proposal).toMatchObject({
      source: "reschedule",
      status: "pending",
      summary: "Move scheduled email reports to Q2 2027",
      operations: [
        {
          type: "update_outcome",
          outcome_key: "OUT-2",
          target: "2027-Q2",
          product_note:
            "Moved from Q1 2027 to Q2 2027. Handling bounced emails turned out to be its own piece of work.",
        },
      ],
    });
    const [superseded] = await db
      .select()
      .from(proposals)
      .where(eq(proposals.id, older.id));
    expect(superseded.status).toBe("superseded");
    expect(llm.prompts[0].user).toContain(
      "TL-10 Retry and bounce handling is due 2027-Q2, after the target.",
    );
  });

  it("asks again when the new target is earlier than the late work", async () => {
    const llm = fakeLLM(move("2027-03-01"), move("2027-Q2"));

    expect(
      await runSlipCheck(db, llm, await outcomeId("OUT-2"), TODAY),
    ).not.toBe(null);
    expect(llm.prompts).toHaveLength(2);
  });

  it("refuses a target that is no later than the current one", async () => {
    await expect(
      runSlipCheck(
        db,
        fakeLLM(move("2027-Q1")),
        await outcomeId("OUT-2"),
        TODAY,
      ),
    ).rejects.toThrow(LLMOutputError);
  });

  it("proposes nothing when the model keeps the target", async () => {
    const before = await pendingReschedules();
    expect(
      await runSlipCheck(
        db,
        fakeLLM(move(null)),
        await outcomeId("OUT-2"),
        TODAY,
      ),
    ).toBe(null);
    expect(await pendingReschedules()).toEqual(before);
  });

  it("does not call the model when nothing looks late", async () => {
    await approve([
      { type: "update_requirement", requirement_key: "TL-10", target: null },
    ]);
    const llm = fakeLLM(move("2027-Q2"));

    expect(await runSlipCheck(db, llm, await outcomeId("OUT-2"), TODAY)).toBe(
      null,
    );
    expect(llm.prompts).toEqual([]);
  });
});
