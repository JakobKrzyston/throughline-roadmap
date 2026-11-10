/** /api/mcp: the MCP server over Streamable HTTP, for agents holding MCP_TOKEN. Stateless: each POST gets its own server. Exports POST, GET, DELETE. */
import { timingSafeEqual } from "node:crypto";

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { getDb } from "@/db/client";
import { isPublicDeployment } from "@/lib/public-deployment";
import { createMcpServer } from "@/mcp/server";

/**
 * Handle one MCP request.
 *
 * Args:
 *   request: A JSON-RPC message from an MCP client, with `Authorization: Bearer <MCP_TOKEN>`.
 *
 * Returns:
 *   503 when MCP_TOKEN is not set or the site is a public deployment, 401 for a missing or wrong
 *   token, otherwise the transport's response.
 */
export async function POST(request: Request): Promise<Response> {
  const token = process.env.MCP_TOKEN;
  // The tools can propose changes to any project, which a public site allows only on demos.
  if (!token || isPublicDeployment()) {
    return Response.json(
      {
        error: "MCP is off: MCP_TOKEN is unset or this is a public deployment",
      },
      { status: 503 },
    );
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

/**
 * Refuse the stream (GET) and session end (DELETE) requests. A stateless server has nothing to
 * stream, and an open GET would hold a serverless function until it timed out.
 *
 * Returns:
 *   405, which tells MCP clients to use POST only.
 */
function methodNotAllowed(): Response {
  return Response.json(
    { error: "Method not allowed" },
    { status: 405, headers: { Allow: "POST" } },
  );
}

export { methodNotAllowed as DELETE, methodNotAllowed as GET };
