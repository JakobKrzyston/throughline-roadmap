/** What the MCP tools read and write: a requirement's context, and a pending proposal to link a pull request. Exports getRequirement, proposeLink, McpToolError. */
import { and, eq } from "drizzle-orm";

import type { GraphOperationInput } from "@/core/operations";
import { type RequirementTree, loadRoadmap } from "@/core/roadmap";
import { rolledUpStatus } from "@/core/rollup";
import type { Database } from "@/db/client";
import {
  links,
  projects,
  proposals,
  requirements,
  workItems,
} from "@/db/schema";

/** A tool call names something that does not exist, or asks for something it cannot have. */
export class McpToolError extends Error {
  name = "McpToolError";
}

/** One requirement as an agent implementing it needs to see it. */
export interface RequirementContext {
  key: string;
  title: string;
  /** Includes the acceptance criteria, when the roadmap wrote them into the description. */
  description: string;
  /** A leaf's own status, or the rolled-up status of a parent. */
  status: string;
  outcome: { key: string; title: string };
  /** The requirement this one was split from, if any. */
  parentKey: string | null;
  children: { key: string; title: string; status: string }[];
  workItems: {
    label: string;
    title: string;
    url: string;
    state: string;
    confidence: string;
  }[];
}

/**
 * Read one requirement with its outcome, children and linked work.
 *
 * Args:
 *   db: Database to read.
 *   projectSlug: The project, e.g. "factory".
 *   key: The requirement key, e.g. "TL-3".
 *
 * Returns:
 *   The requirement's context.
 *
 * Raises:
 *   McpToolError: The project or requirement does not exist.
 */
export async function getRequirement(
  db: Database,
  projectSlug: string,
  key: string,
): Promise<RequirementContext> {
  const project = await findProject(db, projectSlug);
  for (const outcome of await loadRoadmap(db, project.id)) {
    const found = findInTree(outcome.requirements, key, null);
    if (!found) continue;
    const { node, parentKey } = found;
    return {
      key: node.key,
      title: node.title,
      description: node.description,
      status: statusOf(node),
      outcome: { key: outcome.key, title: outcome.title },
      parentKey,
      children: node.children.map((child) => ({
        key: child.key,
        title: child.title,
        status: statusOf(child),
      })),
      workItems: node.workItems.map((item) => ({
        label: item.label,
        title: item.title,
        url: item.url,
        state: item.state,
        confidence: item.confidence,
      })),
    };
  }
  throw new McpToolError(`No requirement ${key} in project ${projectSlug}`);
}

/** The result of asking to link a pull request. */
export type ProposeLinkResult =
  | { status: "pending"; proposalId: string }
  | { status: "already_pending"; proposalId: string }
  | { status: "already_linked" };

/**
 * Propose linking a pull request to the requirement it implements. The link waits in the review
 * queue until a person approves it; nothing in the graph changes here.
 *
 * Args:
 *   db: Database to write to.
 *   projectSlug: The project, e.g. "factory".
 *   pullRequestUrl: The pull request's web address, as GitHub shows it.
 *   key: The requirement key, e.g. "TL-3".
 *   rationale: Why the agent thinks the pull request implements the requirement.
 *
 * Returns:
 *   The new pending proposal, the one already waiting for the same link, or `already_linked`.
 *
 * Raises:
 *   McpToolError: The project, requirement or pull request is not in Throughline.
 */
export async function proposeLink(
  db: Database,
  projectSlug: string,
  pullRequestUrl: string,
  key: string,
  rationale: string,
): Promise<ProposeLinkResult> {
  const project = await findProject(db, projectSlug);
  const [requirement] = await db
    .select()
    .from(requirements)
    .where(
      and(eq(requirements.projectId, project.id), eq(requirements.key, key)),
    );
  if (!requirement) {
    throw new McpToolError(`No requirement ${key} in project ${projectSlug}`);
  }
  // Pull requests reach Throughline through the GitHub sync, never through MCP.
  const [pull] = await db
    .select()
    .from(workItems)
    .where(
      and(
        eq(workItems.projectId, project.id),
        eq(workItems.kind, "pull_request"),
        eq(workItems.url, pullRequestUrl.trim().replace(/\/+$/, "")),
      ),
    );
  if (!pull) {
    throw new McpToolError(
      `Throughline has not seen ${pullRequestUrl} in project ${projectSlug}. A pull request appears shortly after it is opened in a connected repository; try again in a minute.`,
    );
  }

  const linked = await db.$count(
    links,
    and(eq(links.requirementId, requirement.id), eq(links.workItemId, pull.id)),
  );
  if (linked > 0) return { status: "already_linked" };

  const pending = await db
    .select({ id: proposals.id, operations: proposals.operations })
    .from(proposals)
    .where(
      and(
        eq(proposals.triggerWorkItemId, pull.id),
        eq(proposals.source, "mcp"),
        eq(proposals.status, "pending"),
      ),
    );
  const same = pending.find((row) =>
    row.operations.some(
      (op) => op.type === "link_work_item" && op.requirement_key === key,
    ),
  );
  if (same) return { status: "already_pending", proposalId: same.id };

  const operations: GraphOperationInput[] = [
    {
      type: "link_work_item",
      requirement_key: key,
      work_item_id: pull.id,
      relation: "implements",
      // The agent that wrote the pull request says what it is for, as a PR reference would.
      confidence: "explicit",
    },
  ];
  const [proposal] = await db
    .insert(proposals)
    .values({
      projectId: project.id,
      source: "mcp",
      summary: `Link "${pull.title}" to ${key} ${requirement.title}`,
      rationale: rationale.trim(),
      operations,
      triggerWorkItemId: pull.id,
    })
    .returning({ id: proposals.id });
  return { status: "pending", proposalId: proposal.id };
}

async function findProject(
  db: Database,
  slug: string,
): Promise<{ id: string }> {
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, slug));
  if (!project) throw new McpToolError(`No project ${slug}`);
  return project;
}

function findInTree(
  nodes: RequirementTree[],
  key: string,
  parentKey: string | null,
): { node: RequirementTree; parentKey: string | null } | null {
  for (const node of nodes) {
    if (node.key === key) return { node, parentKey };
    const found = findInTree(node.children, key, node.key);
    if (found) return found;
  }
  return null;
}

function statusOf(node: RequirementTree): string {
  return node.children.length > 0
    ? rolledUpStatus([node])
    : (node.status ?? "planned");
}
