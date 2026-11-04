/** Reads a project's graph for the product and technical views. Exports loadRoadmap, loadRecentChanges, loadSplitHistory, availableToday. */
import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";

import type { Database } from "@/db/client";
import { events, links, outcomes, requirements, workItems } from "@/db/schema";

import type { GraphOperation } from "./operations";
import type { RequirementNode } from "./rollup";

type WorkItemRow = typeof workItems.$inferSelect;
type RequirementRow = typeof requirements.$inferSelect;

/** A work item linked to a requirement, as the technical view shows it. */
export interface LinkedWorkItem {
  id: string;
  kind: WorkItemRow["kind"];
  /** The issue or pull request number, e.g. "41". */
  number: string;
  title: string;
  url: string;
  state: WorkItemRow["state"];
  confidence: (typeof links.$inferSelect)["confidence"];
}

/** A requirement with its children and linked work, ready for the rollups in src/core/rollup.ts. */
export interface RequirementTree extends RequirementNode {
  id: string;
  key: string;
  title: string;
  description: string;
  productNote: string | null;
  splitReason: string | null;
  /** The product note written when this leaf was marked done, if any. */
  doneNote: string | null;
  children: RequirementTree[];
  workItems: LinkedWorkItem[];
}

/** An outcome with its requirement tree. */
export interface OutcomeTree {
  id: string;
  key: string;
  title: string;
  description: string;
  target: string | null;
  requirements: RequirementTree[];
}

/** One entry in the "What changed this week" feed. */
export interface RecentChange {
  id: string;
  note: string;
  at: Date;
  /** The outcome the change belongs to. */
  outcomeTitle: string;
  /** The outcome or requirement key, shown only as technical detail. */
  entityKey: string;
}

/** One requirement split, newest first in the technical view. */
export interface SplitRecord {
  id: string;
  at: Date;
  requirementKey: string;
  requirementTitle: string;
  reason: string;
  children: { key: string; title: string }[];
}

// Keys like TL-2 and TL-10 sort by their number, not as text.
const byKey = (a: { key: string }, b: { key: string }): number =>
  a.key.localeCompare(b.key, undefined, { numeric: true });

/**
 * Load every live outcome in a project with its requirement tree and linked work items.
 *
 * Args:
 *   db: Database to read.
 *   projectId: The project.
 *
 * Returns:
 *   Outcomes by priority (lowest number first), then key. Requirements are sorted by key.
 */
export async function loadRoadmap(
  db: Database,
  projectId: string,
): Promise<OutcomeTree[]> {
  const [outcomeRows, requirementRows, linkRows, doneEvents] =
    await Promise.all([
      db
        .select()
        .from(outcomes)
        .where(
          and(eq(outcomes.projectId, projectId), eq(outcomes.archived, false)),
        ),
      db
        .select()
        .from(requirements)
        .where(eq(requirements.projectId, projectId)),
      db
        .select({ link: links, item: workItems })
        .from(links)
        .innerJoin(workItems, eq(links.workItemId, workItems.id))
        .where(eq(workItems.projectId, projectId)),
      // The latest "done" event per leaf. Its note may be empty: a leaf finished again without a
      // note should not show the note from an earlier, superseded finish.
      db
        .selectDistinctOn([events.entityId], {
          entityId: events.entityId,
          productNote: events.productNote,
        })
        .from(events)
        .where(
          and(
            eq(events.projectId, projectId),
            eq(events.type, "set_status"),
            sql`${events.payload}->>'status' = 'done'`,
          ),
        )
        .orderBy(events.entityId, desc(events.seq)),
    ]);

  const doneNotes = new Map(
    doneEvents.map((event) => [event.entityId, event.productNote]),
  );
  // Group once so building the tree is linear in the number of rows.
  const childrenOf = Map.groupBy(requirementRows, (row) => row.parentId);
  const linksOf = Map.groupBy(linkRows, ({ link }) => link.requirementId);

  const toTree = (row: RequirementRow): RequirementTree => ({
    id: row.id,
    key: row.key,
    title: row.title,
    description: row.description,
    status: row.status,
    userVisible: row.userVisible,
    productNote: row.productNote,
    splitReason: row.splitReason,
    doneNote: row.status === "done" ? (doneNotes.get(row.id) ?? null) : null,
    children: (childrenOf.get(row.id) ?? []).sort(byKey).map(toTree),
    workItems: (linksOf.get(row.id) ?? [])
      .map(({ link, item }) => ({
        id: item.id,
        kind: item.kind,
        number: item.externalId.split("#")[1],
        title: item.title,
        url: item.url,
        state: item.state,
        confidence: link.confidence,
      }))
      .sort((a, b) => Number(a.number) - Number(b.number)),
  });

  return outcomeRows
    .sort((a, b) => a.priority - b.priority || byKey(a, b))
    .map((outcome) => ({
      id: outcome.id,
      key: outcome.key,
      title: outcome.title,
      description: outcome.description,
      target: outcome.target,
      requirements: requirementRows
        .filter((row) => row.outcomeId === outcome.id)
        .sort(byKey)
        .map(toTree),
    }));
}

/**
 * Plain-language lines for what customers can use today from one outcome.
 *
 * Args:
 *   roots: The outcome's root requirements.
 *
 * Returns:
 *   One line per finished, user-visible leaf: the note written when it was finished, else its
 *   product note, else its title.
 */
export function availableToday(
  roots: RequirementTree[],
): { key: string; text: string }[] {
  return roots.flatMap((node) => {
    if (node.children.length > 0) return availableToday(node.children);
    if (node.status !== "done" || !node.userVisible) return [];
    return [
      { key: node.key, text: node.doneNote ?? node.productNote ?? node.title },
    ];
  });
}

/**
 * Load the plain-language notes of recent graph changes, for the product view's feed.
 *
 * Args:
 *   db: Database to read.
 *   projectId: The project.
 *   roadmap: The project's live roadmap from loadRoadmap. Changes to archived outcomes are left out.
 *   since: Only changes at or after this time. Defaults to a week ago.
 *   limit: Most changes to return. Defaults to 20, what the product view shows.
 *
 * Returns:
 *   Changes with a product note, newest first.
 */
export async function loadRecentChanges(
  db: Database,
  projectId: string,
  roadmap: OutcomeTree[],
  since: Date = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
  limit = 20,
): Promise<RecentChange[]> {
  // Label every live outcome and requirement with its key and the outcome it belongs to.
  const labels = new Map<string, { key: string; outcomeTitle: string }>();
  const addLabels = (nodes: RequirementTree[], outcomeTitle: string): void =>
    nodes.forEach((node) => {
      labels.set(node.id, { key: node.key, outcomeTitle });
      addLabels(node.children, outcomeTitle);
    });
  for (const outcome of roadmap) {
    labels.set(outcome.id, { key: outcome.key, outcomeTitle: outcome.title });
    addLabels(outcome.requirements, outcome.title);
  }
  if (labels.size === 0) return [];

  const eventRows = await db
    .select()
    .from(events)
    .where(
      and(
        eq(events.projectId, projectId),
        isNotNull(events.productNote),
        gte(events.createdAt, since),
        inArray(events.entityId, [...labels.keys()]),
      ),
    )
    .orderBy(desc(events.seq))
    .limit(limit);

  return eventRows.map((event) => {
    const label = labels.get(event.entityId)!;
    return {
      id: event.id,
      note: event.productNote!,
      at: event.createdAt,
      outcomeTitle: label.outcomeTitle,
      entityKey: label.key,
    };
  });
}

/**
 * Load every requirement split in a project, for the technical view's split history.
 *
 * Args:
 *   db: Database to read.
 *   projectId: The project.
 *   roadmap: The project's live roadmap from loadRoadmap. Splits under archived outcomes are left out.
 *
 * Returns:
 *   Splits newest first, each with its reason and the children it created.
 */
export async function loadSplitHistory(
  db: Database,
  projectId: string,
  roadmap: OutcomeTree[],
): Promise<SplitRecord[]> {
  const titles = new Map<string, string>();
  const addTitles = (nodes: RequirementTree[]): void =>
    nodes.forEach((node) => {
      titles.set(node.key, node.title);
      addTitles(node.children);
    });
  roadmap.forEach((outcome) => addTitles(outcome.requirements));

  const rows = await db
    .select()
    .from(events)
    .where(
      and(
        eq(events.projectId, projectId),
        eq(events.type, "split_requirement"),
      ),
    )
    .orderBy(desc(events.seq));
  return rows.flatMap((row) => {
    // The payload is the validated operation that applyProposal stored.
    const op = row.payload as Extract<
      GraphOperation,
      { type: "split_requirement" }
    >;
    const requirementTitle = titles.get(op.requirement_key);
    if (requirementTitle === undefined) return [];
    return {
      id: row.id,
      at: row.createdAt,
      requirementKey: op.requirement_key,
      requirementTitle,
      reason: op.split_reason,
      children: op.children.map(({ key, title }) => ({ key, title })),
    };
  });
}
