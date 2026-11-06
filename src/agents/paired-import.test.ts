/** Tests for the paired roadmap import agent and approving its proposal, using the fake LLM provider and an in-memory database. */
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { FakeLLMProvider } from "@/adapters/llm/fake";
import { LLMOutputError } from "@/adapters/llm/provider";
import { importMappingSchema } from "@/core/import-mapping";
import { operationListSchema } from "@/core/operations";
import { applyProposal, ProposalError } from "@/core/proposals";
import { loadRoadmap } from "@/core/roadmap";
import { outcomeProgress, productStatus } from "@/core/rollup";
import {
  events,
  outcomes,
  projects,
  proposals,
  requirements,
} from "@/db/schema";
import { createTestDb } from "@/db/test-db";

import { runImport } from "./import";
import {
  isPairedSample,
  PAIRED_SAMPLE,
  pairedImportFixturesFor,
} from "./import-samples";
import { PAIRED_IMPORT_TASK, runPairedImport } from "./paired-import";

type TestDb = Awaited<ReturnType<typeof createTestDb>>;
type Output = typeof PAIRED_SAMPLE.output;

let db: TestDb;
let projectId: string;

beforeEach(async () => {
  db = await createTestDb();
  [{ id: projectId }] = await db
    .insert(projects)
    .values({ name: "Test", slug: "test" })
    .returning();
});

function fakeLLM(...outputs: unknown[]): FakeLLMProvider {
  return new FakeLLMProvider({ [PAIRED_IMPORT_TASK]: outputs });
}

async function importSample(
  llm = fakeLLM(PAIRED_SAMPLE.output),
): Promise<{ proposalId: string; summary: string }> {
  return runPairedImport(
    db,
    llm,
    projectId,
    PAIRED_SAMPLE.product,
    PAIRED_SAMPLE.technical,
  );
}

async function loadProposal(proposalId: string) {
  const [proposal] = await db
    .select()
    .from(proposals)
    .where(eq(proposals.id, proposalId));
  return proposal;
}

// The sample with one change, such as a requirement citing a record it should not.
function sampleWith(change: (output: Output) => void): Output {
  const output = structuredClone(PAIRED_SAMPLE.output);
  change(output);
  return output;
}

describe("runPairedImport", () => {
  it("turns the paired sample into its fixture proposal with no model key", async () => {
    const llm = new FakeLLMProvider(pairedImportFixturesFor());

    const { proposalId, summary } = await importSample(llm);

    expect(isPairedSample(PAIRED_SAMPLE.product, PAIRED_SAMPLE.technical)).toBe(
      true,
    );
    expect(summary).toBe(
      "Import 3 outcomes and 6 requirements from a product and a technical roadmap, with 2 items to place",
    );
    const prompt = llm.prompts[0].user;
    expect(prompt).toContain('<roadmap name="product">');
    expect(prompt).toContain(
      "P0 (header, never cited): Product item,Status,Target,Priority,Notes",
    );
    expect(prompt).toContain("T2: PLAT-202,Email delivery worker");

    const proposal = await loadProposal(proposalId);
    const operations = operationListSchema.parse(proposal.operations);
    // Outcomes first, so a requirement can move to any of them.
    expect(operations.map((op) => op.type)).toEqual([
      ...Array(3).fill("create_outcome"),
      ...Array(6).fill("create_requirement"),
    ]);
    expect(
      operations.flatMap((op) =>
        op.type === "create_requirement"
          ? [[op.key, op.outcome_key, op.title, op.status]]
          : [],
      ),
    ).toEqual([
      ["TL-1", "OUT-1", "Schedule builder in the share menu", "in_progress"],
      ["TL-2", "OUT-1", "Email delivery worker", "done"],
      ["TL-3", "OUT-1", "Dashboard PDF rendering", "planned"],
      ["TL-4", "OUT-2", "Snowflake key-pair authentication", "planned"],
      ["TL-5", "OUT-2", "Incremental Snowflake table sync", "planned"],
      ["TL-6", "OUT-2", "Warehouse query result cache", "planned"],
    ]);

    const mapping = importMappingSchema.parse(proposal.importMapping);
    expect(
      mapping.requirements.find((item) => item.key === "TL-6"),
    ).toMatchObject({ confidence: "low", records: ["T7"] });
    expect(
      mapping.unplaced.map((item) => [
        item.requirement.key,
        item.requirement.title,
        item.suggested_outcome_key,
      ]),
    ).toEqual([
      ["TL-7", "Tune connection pool for sync workers", "OUT-2"],
      ["TL-8", "Upgrade Postgres", null],
    ]);
    // The source rows are kept, including the header, so the review can show them.
    expect(mapping.records.T0).toBe(
      "Issue key,Summary,Issue Type,Status,Epic,Description",
    );
    expect(mapping.records.T2).toContain("Retries bounces with backoff.");
  });

  it("leaves out a shipped product item with its technical rows, and names it in the rationale", async () => {
    const { proposalId } = await importSample();

    const proposal = await loadProposal(proposalId);
    const mapping = importMappingSchema.parse(proposal.importMapping);
    expect(mapping.left_out).toContainEqual({
      records: ["P4", "T8", "T9"],
      title: "Usage page for account owners",
      reason: "already_shipped",
    });
    expect(proposal.rationale).toContain(
      'Left out: "Usage page for account owners" (already shipped); "Slack delivery for scheduled reports" (won\'t do).',
    );
    const titles = operationListSchema
      .parse(proposal.operations)
      .map((op) => ("title" in op ? op.title : ""));
    for (const shipped of [
      "Usage page for account owners",
      "Usage metering pipeline",
      "Usage page UI",
    ]) {
      expect(titles).not.toContain(shipped);
    }
  });

  const invalid: [string, Output, RegExp][] = [
    [
      "cites a reference that does not exist",
      sampleWith((output) => {
        output.requirements[0].records = ["T1", "T99"];
      }),
      /cites T99, which is not a record of the technical roadmap/,
    ],
    [
      "cites a record twice",
      sampleWith((output) => {
        output.requirements[1].records = ["T1", "T2"];
      }),
      /Cited more than once: T1/,
    ],
    [
      "leaves a record uncited",
      sampleWith((output) => {
        output.left_out.pop();
      }),
      /Not cited: T4/,
    ],
    [
      "cites the header row",
      sampleWith((output) => {
        output.outcomes[0].records = ["P0", "P1"];
      }),
      /cites P0, the header row/,
    ],
    [
      "puts a technical record on an outcome",
      sampleWith((output) => {
        output.outcomes[2].records = ["P3", "T11"];
        output.unplaced.pop();
      }),
      /cites T11, which is not a record of the product roadmap/,
    ],
    [
      "links a requirement to an outcome that does not exist",
      sampleWith((output) => {
        output.requirements[0].outcome = "P9";
      }),
      /names outcome P9, but no outcome cites P9/,
    ],
  ];

  it.each(invalid)(
    "retries once when the answer %s, and saves the corrected one",
    async (_, bad) => {
      const llm = fakeLLM(bad, PAIRED_SAMPLE.output);

      await importSample(llm);

      expect(llm.prompts).toHaveLength(2);
      expect(await db.select().from(proposals)).toHaveLength(1);
    },
  );

  it.each(invalid)(
    "saves nothing when the answer %s twice",
    async (_, bad, problem) => {
      const attempt = importSample(fakeLLM(bad));

      await expect(attempt).rejects.toThrow(LLMOutputError);
      await expect(attempt).rejects.toThrow(problem);
      expect(await db.select().from(proposals)).toHaveLength(0);
    },
  );

  it("holds the unplaced items' keys, so a later import cannot take them", async () => {
    await importSample();
    const llm = new FakeLLMProvider({
      roadmap_import: [
        {
          rationale: "",
          outcomes: [
            {
              title: "Alerts",
              description: "",
              target: null,
              priority: 1,
              requirements: [
                {
                  title: "Alert job",
                  description: "",
                  user_visible: false,
                  work_type: "infrastructure",
                  product_note: null,
                },
              ],
            },
          ],
        },
      ],
    });

    const { proposalId } = await runImport(db, llm, projectId, "Alerts");

    const [, requirement] = operationListSchema.parse(
      (await loadProposal(proposalId)).operations,
    );
    expect(requirement).toMatchObject({ key: "TL-9", outcome_key: "OUT-4" });
  });
});

describe("approving a paired import", () => {
  it("is refused while any item still needs a home", async () => {
    const { proposalId } = await importSample();

    await expect(applyProposal(db, proposalId, "pm")).rejects.toThrow(
      'Place or leave out "Tune connection pool for sync workers", "Upgrade Postgres" before approving',
    );
    await expect(
      applyProposal(db, proposalId, "pm", undefined, {
        placements: { "TL-7": "OUT-2" },
      }),
    ).rejects.toThrow(ProposalError);
    expect(await db.select().from(outcomes)).toHaveLength(0);
    expect((await loadProposal(proposalId)).status).toBe("pending");
  });

  it("refuses choices about items the proposal does not have", async () => {
    const { proposalId } = await importSample();
    const placements = { "TL-7": null, "TL-8": null };

    await expect(
      applyProposal(db, proposalId, "pm", undefined, {
        moves: { "TL-99": "OUT-1" },
        placements,
      }),
    ).rejects.toThrow("TL-99 is not a requirement this proposal creates");
    await expect(
      applyProposal(db, proposalId, "pm", undefined, {
        placements: { ...placements, "TL-1": "OUT-2" },
      }),
    ).rejects.toThrow("TL-1 is not waiting to be placed");
  });

  it("applies the reviewer's moves and placements, so the graph matches what they chose", async () => {
    const [existing] = await db
      .insert(outcomes)
      .values({ projectId, key: "OUT-9", title: "Faster dashboards" })
      .returning();
    const { proposalId } = await importSample();

    await applyProposal(db, proposalId, "pm", undefined, {
      // The cache moves from the Snowflake connector to an outcome already in the project.
      moves: { "TL-6": "OUT-9" },
      placements: { "TL-7": "OUT-11", "TL-8": null },
    });

    const outcomeOf = async (title: string) => {
      const [row] = await db
        .select({ key: outcomes.key })
        .from(requirements)
        .innerJoin(outcomes, eq(requirements.outcomeId, outcomes.id))
        .where(
          and(
            eq(requirements.projectId, projectId),
            eq(requirements.title, title),
          ),
        );
      return row?.key;
    };
    expect(await outcomeOf("Warehouse query result cache")).toBe(existing.key);
    // With OUT-9 in the project, the import numbered its outcomes and requirements after it.
    expect(await outcomeOf("Tune connection pool for sync workers")).toBe(
      "OUT-11",
    );
    expect(await outcomeOf("Upgrade Postgres")).toBeUndefined();
    expect(await db.select().from(requirements)).toHaveLength(7);

    // The applied operations are stored, so the proposal records what was approved.
    const stored = operationListSchema.parse(
      (await loadProposal(proposalId)).operations,
    );
    expect(stored.at(-1)).toMatchObject({
      type: "create_requirement",
      key: "TL-7",
      outcome_key: "OUT-11",
    });
  });

  it("counts an imported done requirement toward its outcome's progress at once, with an event", async () => {
    const { proposalId } = await importSample();

    await applyProposal(db, proposalId, "pm", undefined, {
      placements: { "TL-7": "OUT-2", "TL-8": null },
    });

    const roadmap = await loadRoadmap(db, projectId);
    const email = roadmap.find(
      (outcome) => outcome.title === "Scheduled email reports",
    )!;
    expect(outcomeProgress(email.requirements)).toBeCloseTo(1 / 3);
    expect(productStatus(email.requirements)).toBe("in_progress");
    const comments = roadmap.find(
      (outcome) => outcome.title === "Dashboard comments",
    )!;
    expect(productStatus(comments.requirements)).toBe("not_started");

    const [worker] = await db
      .select()
      .from(requirements)
      .where(eq(requirements.title, "Email delivery worker"));
    expect(worker.status).toBe("done");
    const [event] = await db
      .select()
      .from(events)
      .where(eq(events.entityId, worker.id));
    expect(event).toMatchObject({
      type: "create_requirement",
      actor: "pm",
      proposalId,
      payload: expect.objectContaining({ status: "done" }),
    });
  });
});
