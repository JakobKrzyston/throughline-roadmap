/** FallbackLLMProvider: tries one provider and uses another when it fails. Exports FallbackLLMProvider. */
import type { z } from "zod";

import type { LLMProvider, StructuredPrompt } from "./provider";

/**
 * An LLMProvider that answers from `fallback` whenever `primary` throws.
 *
 * Used for demo projects on a public site: a free model answers when it can, and sample results
 * take over when it is rate-limited, down or returns unusable output, so visitors never see an error.
 */
export class FallbackLLMProvider implements LLMProvider {
  constructor(
    private readonly primary: LLMProvider,
    private readonly fallback: LLMProvider,
  ) {}

  /**
   * Ask `primary`, then `fallback` if that fails for any reason.
   *
   * Args:
   *   schema: Zod schema the output must satisfy.
   *   prompt: The task, instructions and input.
   *
   * Returns:
   *   The validated output from whichever provider answered.
   */
  async generateStructured<S extends z.ZodType>(
    schema: S,
    prompt: StructuredPrompt,
  ): Promise<z.output<S>> {
    try {
      return await this.primary.generateStructured(schema, prompt);
    } catch (error) {
      console.warn(
        `LLM provider failed for task "${prompt.task}"; using the fallback:`,
        error,
      );
      return this.fallback.generateStructured(schema, prompt);
    }
  }
}
