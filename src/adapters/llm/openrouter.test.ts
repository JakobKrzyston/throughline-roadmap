/** Tests for OpenRouterProvider against a stubbed fetch; no network calls. */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { OPENROUTER_ENDPOINT, OpenRouterProvider } from "./openrouter";
import { LLMOutputError, type StructuredPrompt } from "./provider";

const schema = z.object({ answer: z.number() });
const prompt: StructuredPrompt = {
  task: "test_task",
  description: "Give the answer.",
  system: "You answer questions.",
  user: "What is six times seven?",
};

function toolReply(id: string, args: unknown): Response {
  return Response.json({
    choices: [
      {
        message: {
          content: null,
          tool_calls: [
            {
              id,
              type: "function",
              function: { name: "test_task", arguments: JSON.stringify(args) },
            },
          ],
        },
      },
    ],
  });
}

function textReply(content: string): Response {
  return Response.json({ choices: [{ message: { content } }] });
}

function stubFetch(...responses: Response[]) {
  const fetchFn = vi.fn<typeof fetch>();
  for (const response of responses) fetchFn.mockResolvedValueOnce(response);
  return fetchFn;
}

function requestBody(fetchFn: ReturnType<typeof stubFetch>, call = 0) {
  return JSON.parse(fetchFn.mock.calls[call][1]!.body as string);
}

describe("OpenRouterProvider", () => {
  it("offers one tool built from the schema and returns its validated arguments", async () => {
    const fetchFn = stubFetch(toolReply("call_1", { answer: 42 }));
    const llm = new OpenRouterProvider("key", "test/model:free", fetchFn);

    await expect(llm.generateStructured(schema, prompt)).resolves.toEqual({
      answer: 42,
    });

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(OPENROUTER_ENDPOINT);
    expect(init!.headers).toMatchObject({ Authorization: "Bearer key" });
    const body = requestBody(fetchFn);
    expect(body.model).toBe("test/model:free");
    expect(body.tool_choice).toEqual({
      type: "function",
      function: { name: "test_task" },
    });
    expect(body.tools[0].function).toMatchObject({
      name: "test_task",
      description: "Give the answer.",
      parameters: expect.objectContaining({ type: "object" }),
    });
    expect(body.tools[0].function.parameters).not.toHaveProperty("$schema");
    expect(body.messages[0].content).toContain("calling the test_task tool");
  });

  it("accepts JSON in the message text, with or without a code fence", async () => {
    const fetchFn = stubFetch(textReply('```json\n{"answer": 42}\n```'));
    const llm = new OpenRouterProvider("key", "m", fetchFn);

    await expect(llm.generateStructured(schema, prompt)).resolves.toEqual({
      answer: 42,
    });
  });

  it("sends the validation error back as a tool result and retries once", async () => {
    const fetchFn = stubFetch(
      toolReply("call_1", { answer: "forty-two" }),
      toolReply("call_2", { answer: 42 }),
    );
    const llm = new OpenRouterProvider("key", "m", fetchFn);

    await expect(llm.generateStructured(schema, prompt)).resolves.toEqual({
      answer: 42,
    });

    expect(fetchFn).toHaveBeenCalledTimes(2);
    const messages = requestBody(fetchFn, 1).messages;
    expect(messages[2]).toMatchObject({
      role: "assistant",
      tool_calls: [{ id: "call_1" }],
    });
    expect(messages[3]).toMatchObject({ role: "tool", tool_call_id: "call_1" });
    expect(messages[3].content).toContain("did not match the schema");
  });

  it("treats a reply that is not JSON as invalid output and nudges as a user turn", async () => {
    const fetchFn = stubFetch(
      textReply("It is 42."),
      toolReply("call_1", { answer: 42 }),
    );
    const llm = new OpenRouterProvider("key", "m", fetchFn);

    await expect(llm.generateStructured(schema, prompt)).resolves.toEqual({
      answer: 42,
    });
    const messages = requestBody(fetchFn, 1).messages;
    expect(messages[2]).toMatchObject({
      role: "assistant",
      content: "It is 42.",
    });
    expect(messages[3]).toMatchObject({ role: "user" });
  });

  it("gives up after the second invalid answer", async () => {
    const fetchFn = stubFetch(textReply("no"), textReply("still no"));
    const llm = new OpenRouterProvider("key", "m", fetchFn);

    await expect(llm.generateStructured(schema, prompt)).rejects.toBeInstanceOf(
      LLMOutputError,
    );
  });

  it("fails with the status when the request is refused", async () => {
    const fetchFn = stubFetch(
      new Response("Rate limit exceeded", { status: 429 }),
    );
    const llm = new OpenRouterProvider("key", "m", fetchFn);

    await expect(llm.generateStructured(schema, prompt)).rejects.toThrow(
      "status 429: Rate limit exceeded",
    );
  });
});
