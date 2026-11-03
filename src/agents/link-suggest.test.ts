/** Tests for the link suggestion agent against the demo seed, with the fake LLM provider. */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { FakeLLMProvider } from "@/adapters/llm/fake";
import { LLMOutputError } from "@/adapters/llm/provider";
import { rejectProposal } from "@/core/proposals";
import { proposals, workItems } from "@/db/schema";
import { seedDemoProject } from "@/db/seed";
import { createTestDb } from "@/db/test-db";

import { LINK_SUGGEST_TASK, runLinkSuggest } from "./link-suggest";

type TestDb = Awaited<ReturnType<typeof createTestDb>>;

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
  await seedDemoProject(db);
  // The seed already suggests a link for pull request 124; clear it so the agent can run.
  const [seeded] = await db
    .select()
    .from(proposals)
    .where(eq(proposals.source, "link_suggest"));
  await rejectProposal(db, seeded.id, "pm");
});

function fakeLLM(...outputs: unknown[]): FakeLLMProvider {
  return new FakeLLMProvider({ [LINK_SUGGEST_TASK]: outputs });
}

/** A seeded work item's id, by its number in the demo repository. */
async function workItemId(number: number): Promise<string> {
  const [row] = await db
    .select({ id: workItems.id })
    .from(workItems)
    .where(eq(workItems.externalId, `100001#${number}`));
  return row.id;
}

const csvMatch = {
  requirement_key: "TL-3",
  relation: "part_of",
  rationale: "It only changes tests for the CSV export endpoint.",
};

describe("runLinkSuggest", () => {
  it("proposes a suggested link to a matching requirement", async () => {
    // The demo's "Fix flaky CSV export test" pull request references no requirement.
    const pullId = await workItemId(124);
    const llm = fakeLLM(csvMatch);

    const proposalId = await runLinkSuggest(db, llm, null, {
      workItemId: pullId,
    });

    const [proposal] = await db
      .select()
      .from(proposals)
      .where(eq(proposals.id, proposalId!));
    expect(proposal).toMatchObject({
      source: "link_suggest",
      status: "pending",
      summary: 'Link "Fix flaky CSV export test" to TL-3 CSV export',
      rationale: csvMatch.rationale,
      triggerWorkItemId: pullId,
      operations: [
        {
          type: "link_work_item",
          requirement_key: "TL-3",
          work_item_id: pullId,
          relation: "part_of",
          confidence: "suggested",
        },
      ],
    });
  });

  it("offers leaf requirements that are not dropped, with their outcomes", async () => {
    const llm = fakeLLM(csvMatch);
    await runLinkSuggest(db, llm, null, { workItemId: await workItemId(124) });

    const { user } = llm.prompts[0];
    expect(user).toContain(
      "- TL-3 CSV export (done; outcome: Customers can export reports to Excel and CSV)",
    );
    expect(user).toContain("- TL-17 Redis cache client (done;");
    expect(user).not.toContain("TL-1 ");
    expect(user).not.toContain("TL-6 ");
    expect(user).toContain("Title: Fix flaky CSV export test");
  });

  it("proposes nothing when the model finds no match", async () => {
    const count = await db.$count(proposals);
    const result = await runLinkSuggest(
      db,
      fakeLLM({ ...csvMatch, requirement_key: null }),
      null,
      { workItemId: await workItemId(124) },
    );
    expect(result).toBeNull();
    expect(await db.$count(proposals)).toBe(count);
  });

  it("rejects a requirement key that is not a candidate", async () => {
    const llm = fakeLLM({ ...csvMatch, requirement_key: "TL-404" });
    await expect(
      runLinkSuggest(db, llm, null, { workItemId: await workItemId(124) }),
    ).rejects.toThrow(LLMOutputError);
  });

  it("skips a work item that already has a pending suggestion", async () => {
    const payload = { workItemId: await workItemId(124) };
    await runLinkSuggest(db, fakeLLM(csvMatch), null, payload);

    const llm = fakeLLM(csvMatch);
    expect(await runLinkSuggest(db, llm, null, payload)).toBeNull();
    expect(llm.prompts).toEqual([]);
  });

  it("skips a work item that has been linked since the job was queued", async () => {
    const llm = fakeLLM(csvMatch);
    expect(
      await runLinkSuggest(db, llm, null, {
        workItemId: await workItemId(125),
      }),
    ).toBeNull();
    expect(llm.prompts).toEqual([]);
  });
});
