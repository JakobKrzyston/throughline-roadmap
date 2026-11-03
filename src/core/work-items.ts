/** Mirrors source work items into a project, links explicit references and queues reconciliation. Exports syncWorkItem, syncRepositoryItem, SYNC_ACTOR, BODY_EXCERPT_LENGTH. */
import { and, eq, inArray } from "drizzle-orm";

import type { SourceWorkItem } from "@/adapters/source";
import type { Database } from "@/db/client";
import {
  links,
  proposals,
  repositories,
  requirements,
  workItems,
} from "@/db/schema";
import { enqueue } from "@/jobs/queue";

import type { GraphOperationInput } from "./operations";
import { applyProposal } from "./proposals";
import { parseReferences } from "./references";

/** The actor recorded on events for links created from explicit PR references. */
export const SYNC_ACTOR = "github-sync";

/** How much of a description is stored as agent context. */
export const BODY_EXCERPT_LENGTH = 2000;

type SyncResult = {
  workItemId: string;
  /** Requirement keys newly linked from explicit references. */
  linked: string[];
  /** Reconciliation jobs queued. */
  reconcileJobs: number;
};

/**
 * Store a work item in a project, link the requirements it explicitly references, and queue
 * reconciliation when it has finished.
 *
 * Safe to repeat: replaying the same item creates no duplicate work items, links or jobs. A
 * reconciliation job is queued for each linked requirement when the item first becomes merged
 * (or, for an issue, closed), and for each new link added to an item that has already finished.
 *
 * Args:
 *   db: Database to write to.
 *   projectId: Project the work item belongs to.
 *   item: The issue or pull request as the source reports it.
 *
 * Returns:
 *   The work item's id, the requirement keys newly linked, and how many reconciliation jobs were queued.
 */
export async function syncWorkItem(
  db: Database,
  projectId: string,
  item: SourceWorkItem,
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
    };
    const { id: workItemId, previousState } = await upsertWorkItem(
      tx,
      projectId,
      item,
      fields,
    );

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
    }

    const finished =
      item.state === "merged" ||
      (item.kind === "issue" && item.state === "closed");
    const justFinished = finished && previousState !== item.state;
    const toReconcile = !finished
      ? []
      : justFinished
        ? [...linkedIds, ...newLinks.map((link) => link.requirementId)]
        : newLinks.map((link) => link.requirementId);
    for (const requirementId of toReconcile) {
      await enqueue(tx, "reconcile", { workItemId, requirementId });
    }

    return {
      workItemId,
      linked: newLinks.map((link) => link.key),
      reconcileJobs: toReconcile.length,
    };
  });
}

/**
 * Sync a work item into every project its repository is connected to.
 *
 * Args:
 *   db: Database to write to.
 *   repositoryExternalId: The source's id for the repository.
 *   item: The issue or pull request.
 *
 * Returns:
 *   One result per connected project; empty if the repository is not connected.
 */
export async function syncRepositoryItem(
  db: Database,
  repositoryExternalId: string,
  item: SourceWorkItem,
): Promise<SyncResult[]> {
  const connected = await db
    .select({ projectId: repositories.projectId })
    .from(repositories)
    .where(
      and(
        eq(repositories.source, item.source),
        eq(repositories.externalId, repositoryExternalId),
      ),
    );
  const results: SyncResult[] = [];
  for (const { projectId } of connected) {
    results.push(await syncWorkItem(db, projectId, item));
  }
  return results;
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
): Promise<{ id: string; previousState: string | null }> {
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
  if (inserted) return { id: inserted.id, previousState: null };

  const match = and(
    eq(workItems.projectId, projectId),
    eq(workItems.source, item.source),
    eq(workItems.externalId, item.externalId),
  );
  // Row lock so concurrent deliveries for this item run one after the other.
  const [existing] = await tx
    .select({ id: workItems.id, state: workItems.state })
    .from(workItems)
    .where(match)
    .for("update");
  await tx.update(workItems).set(fields).where(eq(workItems.id, existing.id));
  return { id: existing.id, previousState: existing.state };
}
