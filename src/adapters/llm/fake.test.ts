/** Tests for FakeLLMProvider and the shared retry-once validation rule. */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { FakeLLMProvider } from "./fake";
import { LLMOutputError, type StructuredPrompt } from "./provider";

const schema = z.object({ answer: z.number() });
const prompt: StructuredPrompt = {
  task: "test_task",
  description: "Answer",
  system: "System",
  user: "User",
};

describe("FakeLLMProvider", () => {
  it("returns a valid fixture", async () => {
    const llm = new FakeLLMProvider({ test_task: [{ answer: 42 }] });
    await expect(llm.generateStructured(schema, prompt)).resolves.toEqual({
      answer: 42,
    });
    expect(llm.prompts).toEqual([prompt]);
  });

  it("retries once when the first output fails validation", async () => {
    const llm = new FakeLLMProvider({
      test_task: [{ answer: "forty-two" }, { answer: 42 }],
    });
    await expect(llm.generateStructured(schema, prompt)).resolves.toEqual({
      answer: 42,
    });
    expect(llm.prompts).toHaveLength(2);
  });

  it("gives up with LLMOutputError after a second invalid output", async () => {
    const llm = new FakeLLMProvider({
      test_task: [{ answer: "no" }, { answer: "still no" }, { answer: 42 }],
    });
    await expect(llm.generateStructured(schema, prompt)).rejects.toThrow(
      LLMOutputError,
    );
    expect(llm.prompts).toHaveLength(2);
  });

  it("fails loudly when a task has no fixture", async () => {
    const llm = new FakeLLMProvider({});
    await expect(llm.generateStructured(schema, prompt)).rejects.toThrow(
      'No fake LLM fixture for task "test_task"',
    );
  });
});
