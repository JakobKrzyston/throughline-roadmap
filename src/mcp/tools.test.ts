/** Tests for the MCP tools: reading a requirement's context and proposing a pull request link. */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { approveProposal } from "@/core/review";
import {
  links,
  outcomes,
  projects,
  proposals,
  requirements,
  workItems,
} from "@/db/schema";
import { createTestDb } from "@/db/test-db";

import { McpToolError, getRequirement, proposeLink } from "./tools";

type TestDb = Awaited<ReturnType<typeof createTestDb>>;

const PR_URL = "https://github.com/acme/app/pull/12";
let db: TestDb;
let projectId: string;
let pullId: string;

beforeEach(async () => {
  db = await createTestDb();
  const [project] = await db
    .insert(projects)
    .values({ name: "Factory", slug: "factory" })
    .returning();
  projectId = project.id;
  const [outcome] = await db
    .insert(outcomes)
    .values({ projectId, key: "OUT-1", title: "Live roadmap" })
    .returning();
  const [parent] = await db
    .insert(requirements)
    .values({
      projectId,
      outcomeId: outcome.id,
      key: "TL-1",
      title: "Private instance",
      description: "A private deployment.\n\nAcceptance: it needs sign-in.",
    })
    .returning();
  const [child] = await db
    .insert(requirements)
    .values([
      {
        projectId,
        parentId: parent.id,
        key: "TL-1.1",
        title: "Database",
        status: "done" as const,
      },
      {
        projectId,
        parentId: parent.id,
        key: "TL-1.2",
        title: "Protection",
        status: "planned" as const,
      },
    ])
    .returning();
  await db.insert(requirements).values({
    projectId,
    outcomeId: outcome.id,
    key: "TL-3",
    title: "MCP server",
    status: "planned",
  });
  const [issue, pull] = await db
    .insert(workItems)
    .values([
      {
        projectId,
        source: "github" as const,
        externalId: "1#5",
        kind: "issue" as const,
        title: "Set up Neon",
        url: "https://github.com/acme/app/issues/5",
        state: "closed" as const,
      },
      {
        projectId,
        source: "github" as const,
        externalId: "1#12",
        kind: "pull_request" as const,
        title: "Add the MCP server",
        url: PR_URL,
        state: "open" as const,
      },
    ])
    .returning();
  pullId = pull.id;
  await db.insert(links).values({
    requirementId: child.id,
    workItemId: issue.id,
    relation: "implements",
    confidence: "explicit",
  });
});

describe("getRequirement", () => {
  it("returns a parent with its outcome, rolled-up status and children", async () => {
    const context = await getRequirement(db, "factory", "TL-1");
    expect(context).toMatchObject({
      key: "TL-1",
      description: "A private deployment.\n\nAcceptance: it needs sign-in.",
      status: "in_progress",
      outcome: { key: "OUT-1", title: "Live roadmap" },
      parentKey: null,
      children: [
        { key: "TL-1.1", title: "Database", status: "done" },
        { key: "TL-1.2", title: "Protection", status: "planned" },
      ],
      workItems: [],
    });
  });

  it("finds a child and lists its linked work", async () => {
    const context = await getRequirement(db, "factory", "TL-1.1");
    expect(context.parentKey).toBe("TL-1");
    expect(context.workItems).toEqual([
      {
        label: "Issue #5",
        title: "Set up Neon",
        url: "https://github.com/acme/app/issues/5",
        state: "closed",
        confidence: "explicit",
      },
    ]);
  });

  it("names what is missing", async () => {
    await expect(getRequirement(db, "factory", "TL-9")).rejects.toThrow(
      new McpToolError("No requirement TL-9 in project factory"),
    );
    await expect(getRequirement(db, "nope", "TL-1")).rejects.toThrow(
      new McpToolError("No project nope"),
    );
  });
});

describe("proposeLink", () => {
  it("creates a pending agent proposal and changes nothing until a person approves it", async () => {
    const result = await proposeLink(
      db,
      "factory",
      `${PR_URL}/`,
      "TL-3",
      " Adds the server TL-3 describes. ",
    );
    expect(result.status).toBe("pending");
    const [proposal] = await db.select().from(proposals);
    expect(proposal).toMatchObject({
      source: "mcp",
      status: "pending",
      summary: 'Link "Add the MCP server" to TL-3 MCP server',
      rationale: "Adds the server TL-3 describes.",
      triggerWorkItemId: pullId,
    });
    expect(await db.$count(links, eq(links.workItemId, pullId))).toBe(0);

    await approveProposal(db, proposal.id, "owner");
    expect(await db.$count(links, eq(links.workItemId, pullId))).toBe(1);
    expect(await proposeLink(db, "factory", PR_URL, "TL-3", "Again.")).toEqual({
      status: "already_linked",
    });
  });

  it("returns the waiting proposal instead of making a second", async () => {
    const first = await proposeLink(db, "factory", PR_URL, "TL-3", "Why.");
    const second = await proposeLink(db, "factory", PR_URL, "TL-3", "Why.");
    expect(second).toEqual({
      status: "already_pending",
      proposalId: (first as { proposalId: string }).proposalId,
    });
    // A different requirement for the same pull request is its own proposal.
    expect(
      (await proposeLink(db, "factory", PR_URL, "TL-1.2", "Also.")).status,
    ).toBe("pending");
    expect(await db.$count(proposals)).toBe(2);
  });

  it("refuses a pull request Throughline has not synced, or an issue", async () => {
    await expect(
      proposeLink(
        db,
        "factory",
        "https://github.com/acme/app/pull/99",
        "TL-3",
        "Why.",
      ),
    ).rejects.toThrow(McpToolError);
    await expect(
      proposeLink(
        db,
        "factory",
        "https://github.com/acme/app/issues/5",
        "TL-3",
        "Why.",
      ),
    ).rejects.toThrow(McpToolError);
    await expect(
      proposeLink(db, "factory", PR_URL, "TL-9", "Why."),
    ).rejects.toThrow("No requirement TL-9 in project factory");
    expect(await db.$count(proposals)).toBe(0);
  });
});
