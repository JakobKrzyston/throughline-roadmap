/** Tests for FallbackLLMProvider. */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { FakeLLMProvider } from "./fake";
import { FallbackLLMProvider } from "./fallback";
import type { LLMProvider, StructuredPrompt } from "./provider";

const schema = z.object({ answer: z.number() });
const prompt: StructuredPrompt = {
  task: "test_task",
  description: "Give the answer.",
  system: "",
  user: "",
};

describe("FallbackLLMProvider", () => {
  it("answers from the primary provider when it works", async () => {
    const llm = new FallbackLLMProvider(
      new FakeLLMProvider({ test_task: [{ answer: 42 }] }),
      new FakeLLMProvider({ test_task: [{ answer: 0 }] }),
    );
    await expect(llm.generateStructured(schema, prompt)).resolves.toEqual({
      answer: 42,
    });
  });

  it("answers from the fallback when the primary fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const primary: LLMProvider = {
      generateStructured: async () => {
        throw new Error("Rate limit exceeded");
      },
    };
    const llm = new FallbackLLMProvider(
      primary,
      new FakeLLMProvider({ test_task: [{ answer: 0 }] }),
    );
    await expect(llm.generateStructured(schema, prompt)).resolves.toEqual({
      answer: 0,
    });
    expect(console.warn).toHaveBeenCalledOnce();
  });
});
