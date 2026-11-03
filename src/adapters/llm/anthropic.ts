/** AnthropicProvider: structured output from Claude through tool use. Exports AnthropicProvider, DEFAULT_MODEL. */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import {
  LLMOutputError,
  type LLMProvider,
  parseWithOneRetry,
  type StructuredPrompt,
} from "./provider";

export const DEFAULT_MODEL = "claude-sonnet-5-5";

/** An LLMProvider backed by the Anthropic Messages API. */
export class AnthropicProvider implements LLMProvider {
  /**
   * Args:
   *   client: Anthropic SDK client. Tests pass a stub.
   *   model: Claude model id.
   */
  constructor(
    private readonly client: Pick<Anthropic, "messages">,
    private readonly model: string = DEFAULT_MODEL,
  ) {}

  /**
   * Offer Claude one tool whose input schema is `schema`, and return the validated tool input.
   *
   * If the input fails validation, the error goes back to Claude as a failed tool result and it
   * gets one more try.
   *
   * Args:
   *   schema: Zod schema for the output. Its top level must be an object.
   *   prompt: The task, instructions and input.
   *
   * Returns:
   *   The validated output.
   *
   * Raises:
   *   LLMOutputError: Claude declined, ran out of output space, or failed validation twice.
   *   Anthropic.APIError: The API request itself failed.
   */
  async generateStructured<S extends z.ZodType>(
    schema: S,
    prompt: StructuredPrompt,
  ): Promise<z.output<S>> {
    // The API rejects the $schema keyword in tool input schemas.
    const inputSchema = z.toJSONSchema(schema, { io: "input" });
    delete inputSchema.$schema;
    const tool: Anthropic.Tool = {
      name: prompt.task,
      description: prompt.description,
      input_schema: inputSchema as Anthropic.Tool.InputSchema,
    };
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: prompt.user },
    ];
    let calls: Anthropic.ToolUseBlock[] = [];

    return parseWithOneRetry(schema, async (previousError) => {
      if (previousError !== null) {
        // Every tool call in the previous turn needs a result, or the API rejects the request.
        messages.push({
          role: "user",
          content: calls.length
            ? calls.map((call) => ({
                type: "tool_result" as const,
                tool_use_id: call.id,
                is_error: true,
                content: `The input did not match the schema. Call ${tool.name} again with corrected input.\n${previousError}`,
              }))
            : `Call the ${tool.name} tool with your answer.`,
        });
      }

      // Forced tool_choice is rejected by current models, so the system prompt asks for the call instead.
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 16000,
        system: `${prompt.system}\n\nGive your answer by calling the ${tool.name} tool exactly once.`,
        tools: [tool],
        messages,
      });
      if (response.stop_reason === "refusal") {
        throw new LLMOutputError(
          "The AI declined to process this input, so nothing was saved.",
        );
      }
      if (response.stop_reason === "max_tokens") {
        throw new LLMOutputError(
          "The input is too long to process in one go, so nothing was saved. Try a shorter section.",
        );
      }

      // The API rejects an empty assistant turn; without it the retry nudge simply follows the user turn.
      if (response.content.length) {
        messages.push({ role: "assistant", content: response.content });
      }
      calls = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
      );
      // No tool call counts as invalid output, so it gets the same single retry.
      return calls[0]?.input;
    });
  }
}
