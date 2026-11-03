/** The LLMProvider interface agents call, plus the shared validate-and-retry-once rule. Exports LLMProvider, StructuredPrompt, LLMOutputError, parseWithOneRetry. */
import { z } from "zod";

/** What an agent asks the model to do. */
export type StructuredPrompt = {
  /** Short snake_case name for the task, e.g. `roadmap_import`. Used as the tool name and to pick fake fixtures. */
  task: string;
  /** One sentence describing the result the model returns. */
  description: string;
  system: string;
  user: string;
};

/** A source of structured output that matches a Zod schema. */
export interface LLMProvider {
  /**
   * Ask the model for output matching `schema`.
   *
   * Args:
   *   schema: Zod schema the output must satisfy.
   *   prompt: The task, instructions and input.
   *
   * Returns:
   *   The validated output.
   *
   * Raises:
   *   LLMOutputError: The model's output still failed validation after one retry, or it gave no usable answer.
   */
  generateStructured<S extends z.ZodType>(
    schema: S,
    prompt: StructuredPrompt,
  ): Promise<z.output<S>>;
}

/** The model did not return usable output. The message is safe to show to a person. */
export class LLMOutputError extends Error {
  name = "LLMOutputError";
}

/**
 * Validate generated output against a schema, asking for one corrected attempt if it fails.
 *
 * Args:
 *   schema: Zod schema the output must satisfy.
 *   generate: Produces one attempt. On the retry it receives the validation error from the first attempt.
 *
 * Returns:
 *   The validated output.
 *
 * Raises:
 *   LLMOutputError: Both attempts failed validation.
 */
export async function parseWithOneRetry<S extends z.ZodType>(
  schema: S,
  generate: (previousError: string | null) => Promise<unknown>,
): Promise<z.output<S>> {
  let previousError: string | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = schema.safeParse(await generate(previousError));
    if (result.success) return result.data;
    previousError = z.prettifyError(result.error);
  }
  throw new LLMOutputError(
    `The AI returned a result in the wrong shape twice, so nothing was saved. Try again, or simplify the input. Details: ${previousError}`,
  );
}
