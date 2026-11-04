/** Tests for the reconciliation agent against the demo seed, with the fake LLM provider and a fake source. */
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { FakeLLMProvider } from "@/adapters/llm/fake";
import { LLMOutputError } from "@/adapters/llm/provider";
import type { SourceAdapter } from "@/adapters/source";
import { applyProposal } from "@/core/proposals";
import {
  outcomeProgress,
  productStatus,
  type RequirementNode,
} from "@/core/rollup";
import {
  events,
  links,
  outcomes,
  proposals,
  repositories,
  requirements,
  workItems,
} from "@/db/schema";
import { seedDemoProject } from "@/db/seed";
import { createTestDb } from "@/db/test-db";

import { SAMPLE_PULL_FILES, SAMPLE_RECONCILE_OUTPUTS } from "./fixtures";
import {
  OTHER_WORK_EXCERPT_LENGTH,
  RECONCILE_TASK,
  runReconcile,
} from "./reconcile";

type TestDb = Awaited<ReturnType<typeof createTestDb>>;
type Requirement = typeof requirements.$inferSelect;

let db: TestDb;
let projectId: string;

const source = {
  source: "github",
  findRepository: async () => null,
  listBackfillPage: async () => ({ items: [], nextCursor: null }),
  listChangedFiles: async () => SAMPLE_PULL_FILES,
} satisfies SourceAdapter;

beforeEach(async () => {
  db = await createTestDb();
  projectId = await seedDemoProject(db);
  // The seed's work item ids use 100001 as the repository id.
  await db.insert(repositories).values({
    projectId,
    source: "github",
    externalId: "100001",
    fullName: "acme/analytics",
  });
});

function fakeLLM(...outputs: unknown[]): FakeLLMProvider {
  return new FakeLLMProvider({ [RECONCILE_TASK]: outputs });
}

async function requirementByKey(key: string): Promise<Requirement> {
  const [row] = await db
    .select()
    .from(requirements)
    .where(eq(requirements.key, key));
  return row;
}

/** The demo's "Excel export: multiple sheets and formatting" pull request and the requirement it implements. */
async function excelPayload(key = "TL-4") {
  const [pull] = await db
    .select()
    .from(workItems)
    .where(eq(workItems.externalId, "100001#125"));
  return {
    workItemId: pull.id,
    requirementId: (await requirementByKey(key)).id,
  };
}

async function reconcile(output: unknown, key = "TL-4"): Promise<string> {
  const proposalId = await runReconcile(
    db,
    fakeLLM(output),
    source,
    await excelPayload(key),
  );
  return proposalId!;
}

async function proposalById(id: string) {
  const [row] = await db.select().from(proposals).where(eq(proposals.id, id));
  return row;
}

async function graph(): Promise<Record<string, unknown[]>> {
  return {
    outcomes: await db.select().from(outcomes),
    requirements: await db.select().from(requirements),
    links: await db.select().from(links),
    events: await db.select().from(events),
  };
}

/** What the product view shows for an outcome: its progress and product status. */
async function productView(outcomeKey: string) {
  const all = await db.select().from(requirements);
  const toNode = (row: Requirement): RequirementNode => ({
    status: row.status,
    userVisible: row.userVisible,
    children: all.filter((r) => r.parentId === row.id).map(toNode),
  });
  const [outcome] = await db
    .select()
    .from(outcomes)
    .where(eq(outcomes.key, outcomeKey));
  const roots = all.filter((r) => r.outcomeId === outcome.id).map(toNode);
  return { progress: outcomeProgress(roots), status: productStatus(roots) };
}

/** What the technical view shows under a requirement: keys and statuses, nested. */
async function technicalTree(key: string): Promise<unknown> {
  const all = await db.select().from(requirements).orderBy(requirements.key);
  const toTree = (row: Requirement): unknown => {
    const children = all.filter((r) => r.parentId === row.id);
    return children.length
      ? { [row.key]: children.map(toTree) }
      : `${row.key}:${row.status}`;
  };
  return toTree(all.find((r) => r.key === key)!);
}

describe("runReconcile", () => {
  it("includes the start of other linked work's descriptions", async () => {
    await db
      .update(workItems)
      .set({ bodyExcerpt: `Writes xlsx with one sheet.\n${"x".repeat(1000)}` })
      .where(eq(workItems.externalId, "100001#106"));
    const llm = fakeLLM(SAMPLE_RECONCILE_OUTPUTS.fully_done);
    await runReconcile(db, llm, source, await excelPayload());

    const otherWork = llm.prompts[0].user.split("<other_work>")[1];
    expect(otherWork).toContain(
      '"Excel export with xlsx writer" (open)\n  Writes xlsx with one sheet.\n  xxx',
    );
    expect(otherWork).not.toContain("x".repeat(OTHER_WORK_EXCERPT_LENGTH));
  });

  it("sends the requirement, its place in the roadmap and the pull request's changes", async () => {
    const llm = fakeLLM(SAMPLE_RECONCILE_OUTPUTS.fully_done);
    await runReconcile(db, llm, source, await excelPayload());

    const { user } = llm.prompts[0];
    expect(user).toContain(
      "Product outcome: Customers can export reports to Excel and CSV",
    );
    expect(user).toContain("Split from TL-1 Async export service");
    expect(user).toContain("Requirement TL-4: Excel export");
    expect(user).toContain("Status: in_progress");
    expect(user).toContain("Kind of work: feature.");
    expect(user).toContain("- TL-3 CSV export (done)");
    expect(user).toContain(
      'Pull request "Excel export with xlsx writer" (open)',
    );
    expect(user).toContain(
      'Pull request "Excel export: multiple sheets and formatting" (merged)',
    );
    expect(user).toContain("- added src/export/xlsx-writer.ts (+184 −0)");
  });

  it("changes nothing in the graph for any classification until a proposal is approved", async () => {
    const before = await graph();
    for (const output of Object.values(SAMPLE_RECONCILE_OUTPUTS)) {
      const proposalId = await reconcile(output);
      expect(await proposalById(proposalId)).toMatchObject({
        status: "pending",
        source: "reconcile",
      });
    }
    expect(await graph()).toEqual(before);
  });
});

describe("classifications", () => {
  it("fully done: proposes marking the requirement done", async () => {
    const proposal = await proposalById(
      await reconcile(SAMPLE_RECONCILE_OUTPUTS.fully_done),
    );
    expect(proposal).toMatchObject({
      summary: "Excel export is finished",
      operations: [
        {
          type: "set_status",
          requirement_key: "TL-4",
          status: "done",
          product_note:
            "Customers can now download any report as an Excel file.",
        },
      ],
    });

    await applyProposal(db, proposal.id, "pm");
    expect((await requirementByKey("TL-4")).status).toBe("done");
  });

  it("partially done: proposes a split into the part that shipped and the part that remains", async () => {
    const proposal = await proposalById(
      await reconcile(SAMPLE_RECONCILE_OUTPUTS.partially_done),
    );
    // TL-23 and TL-24 are taken by the seed's pending import proposal.
    expect(proposal.operations).toEqual([
      {
        type: "split_requirement",
        requirement_key: "TL-4",
        split_reason:
          "The Excel writer shipped without cell formatting, which is a separate piece of work.",
        product_note:
          "Customers can download reports as Excel files today. Formatted spreadsheets with proper number and date styles are planned next.",
        children: [
          expect.objectContaining({
            key: "TL-25",
            status: "done",
            work_type: "feature",
          }),
          expect.objectContaining({
            key: "TL-26",
            status: "planned",
            work_type: "feature",
          }),
        ],
      },
    ]);
  });

  it("done differently: proposes describing what was built and marking it done", async () => {
    const proposal = await proposalById(
      await reconcile(SAMPLE_RECONCILE_OUTPUTS.done_differently),
    );
    expect(proposal.operations).toEqual([
      {
        type: "update_requirement",
        requirement_key: "TL-4",
        title: "Excel export via background jobs",
        description:
          "Workbooks are written server-side by the export job queue and downloaded when ready.",
        product_note:
          "Customers can now download reports as Excel files. They are built in the background, so even very large reports download without timing out.",
      },
      { type: "set_status", requirement_key: "TL-4", status: "done" },
    ]);

    await applyProposal(db, proposal.id, "pm");
    expect(await requirementByKey("TL-4")).toMatchObject({
      title: "Excel export via background jobs",
      status: "done",
      productNote: expect.stringContaining("built in the background"),
    });
  });

  it("scope grew: proposes a split into what shipped and the newly discovered pieces", async () => {
    const proposal = await proposalById(
      await reconcile(SAMPLE_RECONCILE_OUTPUTS.scope_grew),
    );
    expect(proposal.operations).toEqual([
      expect.objectContaining({
        type: "split_requirement",
        requirement_key: "TL-4",
        children: [
          expect.objectContaining({
            key: "TL-25",
            title: "Excel export for standard reports",
            status: "done",
          }),
          expect.objectContaining({
            key: "TL-26",
            title: "Streaming Excel writer",
            status: "planned",
          }),
        ],
      }),
    ]);
  });

  it("every proposal carries a plain-language product note", async () => {
    for (const output of Object.values(SAMPLE_RECONCILE_OUTPUTS)) {
      const { operations } = await proposalById(await reconcile(output));
      const notes = operations.flatMap((op) =>
        "product_note" in op && op.product_note ? [op.product_note] : [],
      );
      expect(notes).toEqual([output.product_note]);
    }
  });
});

describe("approving a split", () => {
  it("updates the product view and the technical view", async () => {
    expect(await productView("OUT-1")).toEqual({
      progress: 2 / 4,
      status: "partially_available",
    });
    const proposalId = await reconcile(SAMPLE_RECONCILE_OUTPUTS.partially_done);

    await applyProposal(db, proposalId, "pm");

    // Product view: the shipped piece counts as done, the remaining piece as one more leaf to do.
    expect(await productView("OUT-1")).toEqual({
      progress: 3 / 5,
      status: "partially_available",
    });
    // Technical view: TL-4 is now a parent under TL-1, and the rest of the tree is unchanged.
    expect(await technicalTree("TL-1")).toEqual({
      "TL-1": [
        "TL-2:done",
        "TL-3:done",
        { "TL-4": ["TL-25:done", "TL-26:planned"] },
        "TL-5:planned",
      ],
    });
    const tl4 = await requirementByKey("TL-4");
    expect(tl4).toMatchObject({
      status: null,
      splitReason: expect.stringContaining("without cell formatting"),
    });
    // The parent keeps its links, so the pull requests stay traceable to the outcome.
    const { workItemId } = await excelPayload();
    expect(
      await db
        .select()
        .from(links)
        .where(
          and(
            eq(links.requirementId, tl4.id),
            eq(links.workItemId, workItemId),
          ),
        ),
    ).toHaveLength(1);
  });
});

describe("superseding", () => {
  it("marks older pending proposals for the same requirement superseded", async () => {
    const pendingBefore = await db
      .select()
      .from(proposals)
      .where(eq(proposals.status, "pending"));
    const seeded = pendingBefore.find((p) => p.source === "reconcile")!;

    const first = await reconcile(SAMPLE_RECONCILE_OUTPUTS.partially_done);
    expect(await proposalById(seeded.id)).toMatchObject({
      status: "superseded",
      decidedBy: "agent",
    });

    const second = await reconcile(SAMPLE_RECONCILE_OUTPUTS.fully_done);
    expect((await proposalById(first)).status).toBe("superseded");
    expect((await proposalById(second)).status).toBe("pending");

    // Proposals about other things stay pending.
    const pendingAfter = await db
      .select({ source: proposals.source })
      .from(proposals)
      .where(eq(proposals.status, "pending"));
    expect(pendingAfter.map((p) => p.source).sort()).toEqual([
      "import",
      "link_suggest",
      "reconcile",
      "reschedule",
    ]);
  });

  it("leaves pending proposals for other requirements alone", async () => {
    await reconcile(SAMPLE_RECONCILE_OUTPUTS.fully_done, "TL-5");
    expect(
      await db.$count(
        proposals,
        and(eq(proposals.source, "reconcile"), eq(proposals.status, "pending")),
      ),
    ).toBe(2);
  });
});

describe("nothing to reconcile", () => {
  it.each([
    ["is already done", "TL-3"],
    ["has been split", "TL-1"],
    ["was dropped", "TL-6"],
  ])("skips a requirement that %s", async (_, key) => {
    const llm = fakeLLM(SAMPLE_RECONCILE_OUTPUTS.fully_done);
    const count = await db.$count(proposals);

    expect(await runReconcile(db, llm, source, await excelPayload(key))).toBe(
      null,
    );
    expect(llm.prompts).toEqual([]);
    expect(await db.$count(proposals)).toBe(count);
  });
});

describe("output validation", () => {
  const { fully_done, partially_done, done_differently } =
    SAMPLE_RECONCILE_OUTPUTS;
  const allShipped = {
    ...partially_done,
    split: {
      ...partially_done.split,
      pieces: partially_done.split.pieces.map((p) => ({ ...p, shipped: true })),
    },
  };

  it.each([
    [
      "a split marked fully done",
      { ...fully_done, split: partially_done.split },
    ],
    [
      "done differently without what was built",
      { ...done_differently, built: null },
    ],
    ["partially done without a split", { ...partially_done, split: null }],
    ["partially done with every piece shipped", allShipped],
    [
      "scope grew with every piece shipped",
      { ...allShipped, classification: "scope_grew" },
    ],
    ["a missing product note", { ...fully_done, product_note: "" }],
  ])("rejects %s and saves nothing", async (_, output) => {
    const count = await db.$count(proposals);
    await expect(reconcile(output)).rejects.toThrow(LLMOutputError);
    expect(await db.$count(proposals)).toBe(count);
  });
});
