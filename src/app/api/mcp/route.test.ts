/** Tests for /api/mcp: the token check, and JSON-RPC tool calls against an in-memory database. */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { outcomes, projects, proposals, requirements } from "@/db/schema";
import { createTestDb } from "@/db/test-db";

type TestDb = Awaited<ReturnType<typeof createTestDb>>;

const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock(import("@/db/client"), async (importOriginal) => ({
  ...(await importOriginal()),
  getDb: () => state.db as TestDb,
}));

const { POST } = await import("./route");

const TOKEN = "mcp-token";
let db: TestDb;

beforeEach(async () => {
  vi.stubEnv("MCP_TOKEN", TOKEN);
  db = await createTestDb();
  state.db = db;
  const [project] = await db
    .insert(projects)
    .values({ name: "Factory", slug: "factory" })
    .returning();
  const [outcome] = await db
    .insert(outcomes)
    .values({ projectId: project.id, key: "OUT-1", title: "Live roadmap" })
    .returning();
  await db.insert(requirements).values({
    projectId: project.id,
    outcomeId: outcome.id,
    key: "TL-3",
    title: "MCP server",
    description: "Agents read requirements.",
    status: "planned",
  });
});

function rpc(
  method: string,
  params: object,
  authorization = `Bearer ${TOKEN}`,
): Request {
  return new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: {
      authorization,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

async function callTool(name: string, args: object) {
  const response = await POST(rpc("tools/call", { name, arguments: args }));
  expect(response.status).toBe(200);
  const { result } = await response.json();
  return result as { content: { text: string }[]; isError?: boolean };
}

describe("/api/mcp", () => {
  it("is off until MCP_TOKEN is set, and refuses a wrong token", async () => {
    vi.stubEnv("MCP_TOKEN", "");
    expect((await POST(rpc("tools/list", {}))).status).toBe(503);
    vi.stubEnv("MCP_TOKEN", TOKEN);
    expect((await POST(rpc("tools/list", {}, "Bearer nope"))).status).toBe(401);
    expect((await POST(rpc("tools/list", {}, ""))).status).toBe(401);
  });

  it("answers initialize and lists both tools", async () => {
    const init = await POST(
      rpc("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      }),
    );
    expect((await init.json()).result.serverInfo.name).toBe("throughline");

    const list = await (await POST(rpc("tools/list", {}))).json();
    expect(
      list.result.tools.map((tool: { name: string }) => tool.name),
    ).toEqual(["get_requirement", "propose_link"]);
  });

  it("reads a requirement", async () => {
    const result = await callTool("get_requirement", {
      project: "factory",
      key: "TL-3",
    });
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      key: "TL-3",
      description: "Agents read requirements.",
      status: "planned",
    });
  });

  it("returns a readable error for an unknown pull request and creates nothing", async () => {
    const result = await callTool("propose_link", {
      project: "factory",
      pull_request_url: "https://github.com/acme/app/pull/1",
      key: "TL-3",
      rationale: "It adds the server.",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/has not seen/);
    expect(await db.$count(proposals)).toBe(0);
  });
});
