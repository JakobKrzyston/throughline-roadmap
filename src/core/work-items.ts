/** Mirrors source work items into a project, links explicit references and queues reconciliation or a link suggestion. Exports syncWorkItem, syncRepositoryItem, isFinished, SYNC_ACTOR, BODY_EXCERPT_LENGTH. */
import { and, eq, inArray } from "drizzle-orm";

import type { SourceRepository, SourceWorkItem } from "@/adapters/source";
import type { Database } from "@/db/client";
import {
  links,
  proposals,
  repositories,
  requirements,
  workItems,
} from "@/db/schema";
import { enqueue, enqueueReconcile } from "@/jobs/queue";

import type { GraphOperationInput } from "./operations";
import { applyProposal } from "./proposals";
import { parseReferences } from "./references";

/** The actor recorded on events for links and status changes made from explicit PR references. */
export const SYNC_ACTOR = "github-sync";

/** How much of a description is stored as agent context. */
export const BODY_EXCERPT_LENGTH = 2000;

type SyncResult = {
  workItemId: string;
  /** Requirement keys newly linked from explicit references. */
  linked: string[];
  /** Planned requirements moved to in progress because an open pull request references them. */
  started: string[];
  /** Requirements queued for reconciliation. */
  reconcileJobs: number;
  /** Whether a link suggestion was queued, for a merged pull request that references nothing. */
  linkSuggestJob: boolean;
};

/**
 * Store a work item in a project, link the requirements it explicitly references, and queue
 * reconciliation when it has finished.
 *
 * Safe to repeat: replaying the same item creates no duplicate work items, links or jobs. An
 * item older than the stored copy (a delivery that arrived out of order) changes nothing. An
 * open pull request moves the planned requirements it is linked to into progress. A
 * reconciliation is queued for each linked requirement when the item first becomes merged
 * (or, for an issue, closed as done), and for each new link added to an item that has already
 * finished. A pull request that merges with no links at all gets a link suggestion job instead,
 * and an explicit link added later supersedes a pending suggestion.
 *
 * Args:
 *   db: Database to write to.
 *   projectId: Project the work item belongs to.
 *   item: The issue or pull request as the source reports it.
 *   options.reconcile: False to store and link without queueing reconciliation or link
 *     suggestions, for importing work that finished before the repository was connected.
 *
 * Returns:
 *   The work item's id, the requirement keys newly linked and newly started, how many
 *   requirements were queued for reconciliation, and whether a link suggestion was.
 */
export async function syncWorkItem(
  db: Database,
  projectId: string,
  item: SourceWorkItem,
  { reconcile = true }: { reconcile?: boolean } = {},
): Promise<SyncResult> {
  return db.transaction(async (tx) => {
    const fields = {
      kind: item.kind,
      title: item.title,
      url: item.url,
      state: item.state,
      bodyExcerpt: item.body.slice(0, BODY_EXCERPT_LENGTH),
      mergedAt: item.mergedAt,
      closedAt: item.closedAt,
      sourceUpdatedAt: item.updatedAt,
    };
    const upserted = await upsertWorkItem(tx, projectId, item, fields);
    const workItemId = upserted.id;
    if (upserted.stale) {
      return {
        workItemId,
        linked: [],
        started: [],
        reconcileJobs: 0,
        linkSuggestJob: false,
      };
    }
    const { previousState } = upserted;

    const alreadyLinked = await tx
      .select({ requirementId: links.requirementId })
      .from(links)
      .where(eq(links.workItemId, workItemId));
    const linkedIds = new Set(alreadyLinked.map((row) => row.requirementId));

    const references = parseReferences(`${item.title}\n${item.body}`);
    const found =
      references.length === 0
        ? []
        : await tx
            .select({ id: requirements.id, key: requirements.key })
            .from(requirements)
            .where(
              and(
                eq(requirements.projectId, projectId),
                inArray(
                  requirements.key,
                  references.map((ref) => ref.key),
                ),
              ),
            );
    // Keys that do not exist in the project are ignored.
    const newLinks = references.flatMap((ref) => {
      const requirement = found.find((row) => row.key === ref.key);
      return requirement && !linkedIds.has(requirement.id)
        ? [{ ...ref, requirementId: requirement.id }]
        : [];
    });

    if (newLinks.length > 0) {
      const operations: GraphOperationInput[] = newLinks.map((link) => ({
        type: "link_work_item",
        requirement_key: link.key,
        work_item_id: workItemId,
        relation: link.relation,
        confidence: "explicit",
      }));
      // Explicit links still go through a proposal, so applyProposal stays the only code that
      // changes the graph and every link gets an event. Nobody needs to review them.
      const [proposal] = await tx
        .insert(proposals)
        .values({
          projectId,
          source: "explicit_link",
          summary: `Link "${item.title}" to ${newLinks.map((link) => link.key).join(", ")}`,
          rationale: "The work item references these requirements by key.",
          operations,
          triggerWorkItemId: workItemId,
        })
        .returning({ id: proposals.id });
      await applyProposal(tx, proposal.id, SYNC_ACTOR);
      // The author has now said what this work is for, so a pending guess is out of date.
      await tx
        .update(proposals)
        .set({
          status: "superseded",
          decidedBy: SYNC_ACTOR,
          decidedAt: new Date(),
        })
        .where(
          and(
            eq(proposals.triggerWorkItemId, workItemId),
            eq(proposals.source, "link_suggest"),
            eq(proposals.status, "pending"),
          ),
        );
    }

    const allLinked = [
      ...linkedIds,
      ...newLinks.map((link) => link.requirementId),
    ];
    const started =
      item.kind === "pull_request" && item.state === "open"
        ? await startWork(tx, projectId, workItemId, item.title, allLinked)
        : [];

    const finished = isFinished(item);
    const justFinished = finished && previousState !== item.state;
    const toReconcile =
      !finished || !reconcile
        ? []
        : justFinished
          ? allLinked
          : newLinks.map((link) => link.requirementId);
    for (const requirementId of toReconcile) {
      await enqueueReconcile(tx, { workItemId, requirementId });
    }
    const suggestLink =
      justFinished &&
      reconcile &&
      item.kind === "pull_request" &&
      linkedIds.size === 0 &&
      newLinks.length === 0;
    if (suggestLink) await enqueue(tx, "link_suggest", { workItemId });

    return {
      workItemId,
      linked: newLinks.map((link) => link.key),
      started,
      reconcileJobs: toReconcile.length,
      linkSuggestJob: suggestLink,
    };
  });
}

/**
 * Move the planned requirements among `requirementIds` to in progress, because an open pull
 * request references them. Requirements already started, finished, dropped or split are left alone.
 *
 * Like explicit links, this is deterministic, so the proposal is approved at once by the sync.
 *
 * Returns:
 *   The keys of the requirements that were started.
 */
async function startWork(
  tx: Transaction,
  projectId: string,
  workItemId: string,
  title: string,
  requirementIds: string[],
): Promise<string[]> {
  if (requirementIds.length === 0) return [];
  const planned = await tx
    .select({ key: requirements.key })
    .from(requirements)
    .where(
      and(
        inArray(requirements.id, requirementIds),
        eq(requirements.status, "planned"),
      ),
    )
    .orderBy(requirements.key);
  if (planned.length === 0) return [];

  const keys = planned.map((row) => row.key);
  const [proposal] = await tx
    .insert(proposals)
    .values({
      projectId,
      source: "work_started",
      summary: `Work started on ${keys.join(", ")}: "${title}"`,
      rationale:
        "An open pull request references these requirements, so work on them has started.",
      operations: keys.map((key) => ({
        type: "set_status",
        requirement_key: key,
        status: "in_progress",
      })),
      triggerWorkItemId: workItemId,
    })
    .returning({ id: proposals.id });
  await applyProposal(tx, proposal.id, SYNC_ACTOR);
  return keys;
}

/**
 * Sync a work item into every project its repository is connected to, and record the
 * repository's current name in case it was renamed.
 *
 * Args:
 *   db: Database to write to.
 *   repository: The repository as the source reports it now.
 *   item: The issue or pull request.
 *
 * Returns:
 *   One result per connected project; empty if the repository is not connected.
 */
export async function syncRepositoryItem(
  db: Database,
  repository: SourceRepository,
  item: SourceWorkItem,
): Promise<SyncResult[]> {
  const connected = await db
    .update(repositories)
    .set({ fullName: repository.fullName })
    .where(
      and(
        eq(repositories.source, item.source),
        eq(repositories.externalId, repository.externalId),
      ),
    )
    .returning({ projectId: repositories.projectId });
  const results: SyncResult[] = [];
  for (const { projectId } of connected) {
    results.push(await syncWorkItem(db, projectId, item));
  }
  return results;
}

/**
 * Whether a work item's work is done: a merged pull request, or an issue closed as done.
 *
 * Args:
 *   item: The work item's kind and state.
 *
 * Returns:
 *   True when it should be reconciled against the requirements it is linked to.
 */
export function isFinished(item: {
  kind: "issue" | "pull_request";
  state: "open" | "closed" | "merged" | "not_planned";
}): boolean {
  return (
    item.state === "merged" ||
    (item.kind === "issue" && item.state === "closed")
  );
}

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function upsertWorkItem(
  tx: Transaction,
  projectId: string,
  item: SourceWorkItem,
  fields: Omit<
    typeof workItems.$inferInsert,
    "projectId" | "source" | "externalId"
  >,
): Promise<
  | { id: string; stale: false; previousState: string | null }
  | { id: string; stale: true }
> {
  // Insert first: if another delivery for the same item is mid-transaction, this waits for it
  // to commit, so the state read below is never stale.
  const [inserted] = await tx
    .insert(workItems)
    .values({
      ...fields,
      projectId,
      source: item.source,
      externalId: item.externalId,
    })
    .onConflictDoNothing()
    .returning({ id: workItems.id });
  if (inserted) return { id: inserted.id, stale: false, previousState: null };

  const match = and(
    eq(workItems.projectId, projectId),
    eq(workItems.source, item.source),
    eq(workItems.externalId, item.externalId),
  );
  // Row lock so concurrent deliveries for this item run one after the other.
  const [existing] = await tx
    .select({
      id: workItems.id,
      state: workItems.state,
      sourceUpdatedAt: workItems.sourceUpdatedAt,
    })
    .from(workItems)
    .where(match)
    .for("update");
  // GitHub does not deliver webhooks in order. An equal timestamp still applies: GitHub reports
  // whole seconds, so two changes in the same second can only be taken in arrival order.
  if (existing.sourceUpdatedAt && item.updatedAt < existing.sourceUpdatedAt) {
    return { id: existing.id, stale: true };
  }
  await tx.update(workItems).set(fields).where(eq(workItems.id, existing.id));
  return { id: existing.id, stale: false, previousState: existing.state };
}
