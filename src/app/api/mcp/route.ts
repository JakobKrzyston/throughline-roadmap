/** /api/mcp: the MCP server over Streamable HTTP, for agents holding MCP_TOKEN. Stateless: each request gets its own server. */
import { timingSafeEqual } from "node:crypto";

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { getDb } from "@/db/client";
import { createMcpServer } from "@/mcp/server";

/**
 * Handle one MCP request.
 *
 * Args:
 *   request: A JSON-RPC message from an MCP client, with `Authorization: Bearer <MCP_TOKEN>`.
 *
 * Returns:
 *   503 when MCP_TOKEN is not set, 401 for a missing or wrong token, otherwise the transport's
 *   response.
 */
async function handle(request: Request): Promise<Response> {
  const token = process.env.MCP_TOKEN;
  if (!token) {
    return Response.json({ error: "MCP_TOKEN is not set" }, { status: 503 });
  }
  if (!isAuthorized(request.headers.get("authorization"), token)) {
    return Response.json({ error: "Bad token" }, { status: 401 });
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await createMcpServer(getDb()).connect(transport);
  return transport.handleRequest(request);
}

function isAuthorized(header: string | null, token: string): boolean {
  const given = Buffer.from(header ?? "");
  const expected = Buffer.from(`Bearer ${token}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export { handle as DELETE, handle as GET, handle as POST };
