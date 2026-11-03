/** Reads a project's graph for the product and technical views. Exports loadRoadmap, loadRecentChanges, loadSplitHistory, availableToday. */
import { and, asc, desc, eq, gte, isNotNull } from "drizzle-orm";

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
  /** The outcome the change belongs to; null if it has since been archived. */
  outcomeTitle: string | null;
  /** The outcome or requirement key, shown only as technical detail. */
  entityKey: string | null;
}

/** One requirement split, newest first in the technical view. */
export interface SplitRecord {
  id: string;
  at: Date;
  requirementKey: string;
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
      db
        .select({
          entityId: events.entityId,
          payload: events.payload,
          productNote: events.productNote,
        })
        .from(events)
        .where(
          and(
            eq(events.projectId, projectId),
            eq(events.type, "set_status"),
            isNotNull(events.productNote),
          ),
        )
        .orderBy(asc(events.createdAt)),
    ]);

  // Later events overwrite earlier ones, so each leaf keeps its latest note.
  const doneNotes = new Map<string, string>();
  for (const event of doneEvents) {
    const op = event.payload as Extract<GraphOperation, { type: "set_status" }>;
    if (op.status === "done") doneNotes.set(event.entityId, event.productNote!);
  }

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
    children: requirementRows
      .filter((child) => child.parentId === row.id)
      .sort(byKey)
      .map(toTree),
    workItems: linkRows
      .filter(({ link }) => link.requirementId === row.id)
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
 *   since: Only changes at or after this time. Defaults to a week ago.
 *
 * Returns:
 *   Up to 20 changes with a product note, newest first.
 */
export async function loadRecentChanges(
  db: Database,
  projectId: string,
  since: Date = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
): Promise<RecentChange[]> {
  const [eventRows, outcomeRows, requirementRows] = await Promise.all([
    db
      .select()
      .from(events)
      .where(
        and(
          eq(events.projectId, projectId),
          isNotNull(events.productNote),
          gte(events.createdAt, since),
        ),
      )
      .orderBy(desc(events.createdAt))
      .limit(20),
    db
      .select()
      .from(outcomes)
      .where(
        and(eq(outcomes.projectId, projectId), eq(outcomes.archived, false)),
      ),
    db.select().from(requirements).where(eq(requirements.projectId, projectId)),
  ]);
  const outcomesById = new Map(outcomeRows.map((row) => [row.id, row]));
  const requirementsById = new Map(requirementRows.map((row) => [row.id, row]));

  // Walk up from a requirement to the outcome its tree hangs from.
  const outcomeOf = (requirement: RequirementRow): string =>
    requirement.outcomeId ??
    outcomeOf(requirementsById.get(requirement.parentId!)!);

  return eventRows.map((event) => {
    const requirement =
      event.entityType === "requirement"
        ? requirementsById.get(event.entityId)
        : undefined;
    const outcome = outcomesById.get(
      requirement ? outcomeOf(requirement) : event.entityId,
    );
    return {
      id: event.id,
      note: event.productNote!,
      at: event.createdAt,
      outcomeTitle: outcome?.title ?? null,
      entityKey: requirement?.key ?? outcome?.key ?? null,
    };
  });
}

/**
 * Load every requirement split in a project, for the technical view's split history.
 *
 * Args:
 *   db: Database to read.
 *   projectId: The project.
 *
 * Returns:
 *   Splits newest first, each with its reason and the children it created.
 */
export async function loadSplitHistory(
  db: Database,
  projectId: string,
): Promise<SplitRecord[]> {
  const rows = await db
    .select()
    .from(events)
    .where(
      and(
        eq(events.projectId, projectId),
        eq(events.type, "split_requirement"),
      ),
    )
    .orderBy(desc(events.createdAt));
  return rows.map((row) => {
    // The payload is the validated operation that applyProposal stored.
    const op = row.payload as Extract<
      GraphOperation,
      { type: "split_requirement" }
    >;
    return {
      id: row.id,
      at: row.createdAt,
      requirementKey: op.requirement_key,
      reason: op.split_reason,
      children: op.children.map(({ key, title }) => ({ key, title })),
    };
  });
}
