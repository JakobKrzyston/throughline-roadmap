/** OpenRouterProvider: structured output from any OpenRouter model through tool calling, over fetch. Exports OpenRouterProvider, OPENROUTER_DEFAULT_MODEL, OPENROUTER_ENDPOINT. */
import { z } from "zod";

import {
  type LLMProvider,
  parseWithOneRetry,
  type StructuredPrompt,
} from "./provider";

/** A free model with tool calling at the time of writing. Free models come and go; docs/DEPLOY.md says how to pick another. */
export const OPENROUTER_DEFAULT_MODEL =
  "nvidia/nemotron-3-ultra-550b-a55b:free";

export const OPENROUTER_ENDPOINT =
  "https://openrouter.ai/api/v1/chat/completions";

const toolCallSchema = z.object({
  id: z.string(),
  type: z.literal("function"),
  function: z.object({ name: z.string(), arguments: z.string() }),
});

const responseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullish(),
          tool_calls: z.array(toolCallSchema).nullish(),
        }),
      }),
    )
    .min(1),
});

type ToolCall = z.output<typeof toolCallSchema>;

/** One turn in the OpenAI-style conversation OpenRouter accepts. */
type Message =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

/** An LLMProvider backed by OpenRouter's OpenAI-compatible chat completions API. */
export class OpenRouterProvider implements LLMProvider {
  /**
   * Args:
   *   apiKey: OpenRouter API key.
   *   model: OpenRouter model id, e.g. `google/gemma-4-31b-it:free`.
   *   fetchFn: HTTP client; tests pass a stub.
   */
  constructor(
    private readonly apiKey: string,
    private readonly model: string = OPENROUTER_DEFAULT_MODEL,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  /**
   * Offer the model one tool whose parameters are `schema`, and return the validated arguments.
   *
   * Models that answer with JSON in the message text instead of a tool call are accepted too,
   * since free models do not all honour `tool_choice`. Invalid output gets one retry with the
   * validation error.
   *
   * Args:
   *   schema: Zod schema for the output. Its top level must be an object.
   *   prompt: The task, instructions and input.
   *
   * Returns:
   *   The validated output.
   *
   * Raises:
   *   LLMOutputError: The model failed validation twice.
   *   Error: The request failed, for example a rate limit; the message includes the status.
   */
  async generateStructured<S extends z.ZodType>(
    schema: S,
    prompt: StructuredPrompt,
  ): Promise<z.output<S>> {
    const parameters = z.toJSONSchema(schema, { io: "input" });
    delete parameters.$schema;
    const tool = {
      type: "function",
      function: {
        name: prompt.task,
        description: prompt.description,
        parameters,
      },
    };
    const messages: Message[] = [
      {
        role: "system",
        content: `${prompt.system}\n\nGive your answer by calling the ${prompt.task} tool exactly once.`,
      },
      { role: "user", content: prompt.user },
    ];
    let calls: ToolCall[] = [];

    return parseWithOneRetry(schema, async (previousError) => {
      if (previousError !== null) {
        const correction = `The input did not match the schema. Call ${prompt.task} again with corrected input.\n${previousError}`;
        // Every tool call in the previous turn needs a result, or the API rejects the request.
        if (calls.length) {
          messages.push(
            ...calls.map((call) => ({
              role: "tool" as const,
              tool_call_id: call.id,
              content: correction,
            })),
          );
        } else {
          messages.push({ role: "user", content: correction });
        }
      }

      const response = await this.fetchFn(OPENROUTER_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          // Optional attribution OpenRouter shows on its leaderboard.
          "HTTP-Referer":
            "https://github.com/JakobKrzyston/throughline-roadmap",
          "X-Title": "Throughline",
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          tools: [tool],
          tool_choice: { type: "function", function: { name: prompt.task } },
        }),
      });
      if (!response.ok) {
        throw new Error(
          `OpenRouter request failed with status ${response.status}: ${(await response.text()).slice(0, 500)}`,
        );
      }
      const { message } = responseSchema.parse(await response.json())
        .choices[0];
      calls = message.tool_calls ?? [];
      // An assistant turn needs content or tool calls; an empty reply is simply not recorded.
      if (message.content || calls.length) {
        messages.push({
          role: "assistant",
          content: message.content ?? null,
          ...(calls.length ? { tool_calls: calls } : {}),
        });
      }
      return parseJson(calls[0]?.function.arguments ?? message.content);
    });
  }
}

/** JSON from a tool call or a message, with any code fence stripped. Undefined when it is not JSON, so it counts as invalid output. */
function parseJson(text: string | null | undefined): unknown {
  if (!text) return undefined;
  const bare = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(bare);
  } catch {
    return undefined;
  }
}
