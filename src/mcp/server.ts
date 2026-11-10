/** The MCP server: tools an outside agent uses to read a requirement and propose a link for a person to approve. Exports createMcpServer. */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { Database } from "@/db/client";

import { McpToolError, getRequirement, proposeLink } from "./tools";

const project = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .describe('The project slug from its address, /p/<slug>, e.g. "factory".');
const key = z
  .string()
  .trim()
  .min(1)
  .max(50)
  .describe('The requirement key, e.g. "TL-3".');

/**
 * Create an MCP server whose tools read and propose against one database. Every write is a
 * pending proposal: nothing an MCP client sends changes the graph until a person approves it.
 *
 * Args:
 *   db: Database the tools use.
 *
 * Returns:
 *   A server with get_requirement and propose_link registered, ready to connect to a transport.
 */
export function createMcpServer(db: Database): McpServer {
  const server = new McpServer({ name: "throughline", version: "1.0.0" });

  server.registerTool(
    "get_requirement",
    {
      description:
        "Read a requirement: its description and acceptance criteria, status, outcome, children and linked issues and pull requests.",
      inputSchema: { project, key },
      annotations: { readOnlyHint: true },
    },
    ({ project, key }) => respond(async () => getRequirement(db, project, key)),
  );

  server.registerTool(
    "propose_link",
    {
      description:
        "Propose that a pull request implements a requirement. Creates a pending proposal in the project's review queue; a person must approve it before the link exists. The pull request must already be in Throughline, which happens shortly after it is opened in a connected repository.",
      inputSchema: {
        project,
        pull_request_url: z
          .url()
          .max(500)
          .describe(
            "The pull request's web address, e.g. https://github.com/owner/repo/pull/12.",
          ),
        key,
        rationale: z
          .string()
          .trim()
          .min(1)
          .max(1000)
          .describe(
            "One or two sentences on why this pull request implements the requirement, for the reviewer.",
          ),
      },
    },
    ({ project, pull_request_url, key, rationale }) =>
      respond(async () =>
        proposeLink(db, project, pull_request_url, key, rationale),
      ),
  );

  return server;
}

/**
 * Run a tool and return its result as JSON text. A McpToolError becomes an error the agent can
 * read; anything else is logged here and reported without its details, which may be database text.
 */
async function respond(run: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    const result = await run();
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    if (error instanceof McpToolError) {
      return {
        content: [{ type: "text", text: error.message }],
        isError: true,
      };
    }
    console.error("MCP tool failed", error);
    return {
      content: [{ type: "text", text: "Throughline hit an internal error." }],
      isError: true,
    };
  }
}
