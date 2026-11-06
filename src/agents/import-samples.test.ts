/** Tests for the sample roadmap exports and the demo proposals served for them. */
import { describe, expect, it } from "vitest";

import { FakeLLMProvider } from "@/adapters/llm/fake";
import { applyProposal } from "@/core/proposals";
import { outcomes, projects, requirements } from "@/db/schema";
import { createTestDb } from "@/db/test-db";

import { SAMPLE_IMPORT_OUTPUT } from "./fixtures";
import { IMPORT_TASK, runImport } from "./import";
import { IMPORT_SAMPLES, importFixturesFor } from "./import-samples";

// Issue keys and the long numeric or hex ids the exports carry.
const INTERNAL_ID = /\b[A-Z]{2,}-\d+\b|\b\d{5,}\b|\b[0-9a-f]{16,}\b/;

describe("IMPORT_SAMPLES", () => {
  it.each(IMPORT_SAMPLES)(
    "the $label sample becomes a proposal that applies cleanly",
    async (sample) => {
      const db = await createTestDb();
      const [project] = await db
        .insert(projects)
        .values({ name: "Test", slug: "test" })
        .returning();
      const llm = new FakeLLMProvider(importFixturesFor(sample.content));

      const { proposalId } = await runImport(
        db,
        llm,
        project.id,
        sample.content,
      );
      await applyProposal(db, proposalId, "pm");

      expect(llm.prompts[0].user).toContain(sample.content.trim());
      expect(await db.select().from(outcomes)).toHaveLength(
        sample.output.outcomes.length,
      );
      expect(await db.select().from(requirements)).toHaveLength(
        sample.output.outcomes.flatMap((outcome) => outcome.requirements)
          .length,
      );
    },
  );

  it.each(IMPORT_SAMPLES)(
    "the $label sample's outcomes carry no ticket numbers or ids",
    (sample) => {
      // The export itself is full of them, so the check would catch them being copied.
      expect(sample.content).toMatch(INTERNAL_ID);
      for (const outcome of sample.output.outcomes) {
        expect(outcome.title).not.toMatch(INTERNAL_ID);
        expect(outcome.description).not.toMatch(INTERNAL_ID);
      }
    },
  );
});

describe("importFixturesFor", () => {
  const [jira] = IMPORT_SAMPLES;

  it("serves a sample's own proposal, even with the browser's CRLF line breaks", () => {
    const sent = `${jira.content.replace(/\n/g, "\r\n")}  `;
    expect(importFixturesFor(sent)[IMPORT_TASK]).toEqual([jira.output]);
  });

  it("serves the usual demo proposal for anything else", () => {
    expect(
      importFixturesFor(`${jira.content}\nOne more row`)[IMPORT_TASK],
    ).toEqual([SAMPLE_IMPORT_OUTPUT]);
  });
});
