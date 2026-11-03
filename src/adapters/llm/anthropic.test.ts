/** Tests for AnthropicProvider against a stubbed SDK client; no network calls. */
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { AnthropicProvider } from "./anthropic";
import { LLMOutputError, type StructuredPrompt } from "./provider";

const schema = z.object({ answer: z.number() });
const prompt: StructuredPrompt = {
  task: "test_task",
  description: "Give the answer.",
  system: "You answer questions.",
  user: "What is six times seven?",
};

function toolCall(id: string, input: unknown): Anthropic.ToolUseBlock {
  return {
    type: "tool_use",
    id,
    name: "test_task",
    input,
  } as Anthropic.ToolUseBlock;
}

function reply(
  content: Anthropic.ContentBlock[],
  stop_reason: Anthropic.StopReason = "tool_use",
): Anthropic.Message {
  return { content, stop_reason } as Anthropic.Message;
}

function stubClient(...responses: Anthropic.Message[]) {
  const create = vi.fn();
  for (const response of responses) create.mockResolvedValueOnce(response);
  const client = { messages: { create } } as unknown as Pick<
    Anthropic,
    "messages"
  >;
  return { client, create };
}

describe("AnthropicProvider", () => {
  it("offers one tool built from the schema and returns its validated input", async () => {
    const { client, create } = stubClient(
      reply([toolCall("call_1", { answer: 42 })]),
    );
    const llm = new AnthropicProvider(client, "claude-test");

    await expect(llm.generateStructured(schema, prompt)).resolves.toEqual({
      answer: 42,
    });

    const request = create.mock.calls[0][0];
    expect(request.model).toBe("claude-test");
    expect(request.tool_choice).toBeUndefined();
    expect(request.system).toContain("calling the test_task tool");
    expect(request.tools).toEqual([
      {
        name: "test_task",
        description: "Give the answer.",
        input_schema: expect.objectContaining({ type: "object" }),
      },
    ]);
    expect(request.tools[0].input_schema).not.toHaveProperty("$schema");
  });

  it("sends the validation error back as a failed tool result and retries once", async () => {
    const { client, create } = stubClient(
      reply([toolCall("call_1", { answer: "forty-two" })]),
      reply([toolCall("call_2", { answer: 42 })]),
    );
    const llm = new AnthropicProvider(client);

    await expect(llm.generateStructured(schema, prompt)).resolves.toEqual({
      answer: 42,
    });

    expect(create).toHaveBeenCalledTimes(2);
    const retryTurn = create.mock.calls[1][0].messages[2];
    expect(retryTurn.role).toBe("user");
    expect(retryTurn.content).toEqual([
      expect.objectContaining({
        type: "tool_result",
        tool_use_id: "call_1",
        is_error: true,
      }),
    ]);
  });

  it("treats a reply with no tool call as invalid output", async () => {
    const { client, create } = stubClient(
      reply(
        [{ type: "text", text: "It is 42." } as Anthropic.TextBlock],
        "end_turn",
      ),
      reply([toolCall("call_1", { answer: 42 })]),
    );
    const llm = new AnthropicProvider(client);

    await expect(llm.generateStructured(schema, prompt)).resolves.toEqual({
      answer: 42,
    });
    expect(create.mock.calls[1][0].messages[2].content).toContain(
      "Call the test_task tool",
    );
  });

  it("retries an empty reply without sending an empty assistant turn", async () => {
    const { client, create } = stubClient(
      reply([], "end_turn"),
      reply([toolCall("call_1", { answer: 42 })]),
    );
    const llm = new AnthropicProvider(client);

    await expect(llm.generateStructured(schema, prompt)).resolves.toEqual({
      answer: 42,
    });
    const sent = create.mock.calls[1][0].messages;
    expect(sent[1]).toEqual({
      role: "user",
      content: "Call the test_task tool with your answer.",
    });
    expect(
      sent.some(
        (m: { role: string; content: unknown[] }) =>
          m.role === "assistant" && m.content.length === 0,
      ),
    ).toBe(false);
  });

  it("throws LLMOutputError after two invalid replies", async () => {
    const { client, create } = stubClient(
      reply([toolCall("call_1", { answer: "no" })]),
      reply([toolCall("call_2", { answer: "still no" })]),
    );
    const llm = new AnthropicProvider(client);

    await expect(llm.generateStructured(schema, prompt)).rejects.toThrow(
      LLMOutputError,
    );
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("does not retry a refusal", async () => {
    const { client, create } = stubClient(reply([], "refusal"));
    const llm = new AnthropicProvider(client);

    await expect(llm.generateStructured(schema, prompt)).rejects.toThrow(
      "declined",
    );
    expect(create).toHaveBeenCalledTimes(1);
  });
});
