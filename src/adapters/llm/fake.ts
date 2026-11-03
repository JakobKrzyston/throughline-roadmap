/** FakeLLMProvider: returns canned outputs per task, for tests and demo mode. Exports FakeLLMProvider, FakeFixtures. */
import type { z } from "zod";

import {
  type LLMProvider,
  parseWithOneRetry,
  type StructuredPrompt,
} from "./provider";

/** Outputs to return per task name, in order. The last one repeats once the list runs out. */
export type FakeFixtures = Record<string, unknown[]>;

/** An LLMProvider that never calls a model. It validates fixtures exactly as real output is validated. */
export class FakeLLMProvider implements LLMProvider {
  /** Every prompt received, in order, so tests can inspect what an agent sent. */
  readonly prompts: StructuredPrompt[] = [];
  private readonly served = new Map<string, number>();

  constructor(private readonly fixtures: FakeFixtures) {}

  /**
   * Return the next fixture for `prompt.task`, validated against `schema`.
   *
   * Args:
   *   schema: Zod schema the fixture must satisfy.
   *   prompt: The prompt; only its task name selects the fixture.
   *
   * Returns:
   *   The validated fixture.
   *
   * Raises:
   *   Error: No fixtures exist for the task.
   *   LLMOutputError: The fixtures fail validation on both attempts.
   */
  async generateStructured<S extends z.ZodType>(
    schema: S,
    prompt: StructuredPrompt,
  ): Promise<z.output<S>> {
    const outputs = this.fixtures[prompt.task];
    if (!outputs?.length) {
      throw new Error(`No fake LLM fixture for task "${prompt.task}"`);
    }
    return parseWithOneRetry(schema, async () => {
      this.prompts.push(prompt);
      const index = this.served.get(prompt.task) ?? 0;
      this.served.set(prompt.task, index + 1);
      return outputs[Math.min(index, outputs.length - 1)];
    });
  }
}
