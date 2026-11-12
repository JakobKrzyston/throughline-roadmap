/** Mirrors source work items and feedback into a project, links explicit references and queues reconciliation, a link suggestion or a feedback match. Exports syncWorkItem, syncFeedback, syncRepositoryItem, isFinished, hasStarted, SYNC_ACTOR, LINEAR_SYNC_ACTOR, BODY_EXCERPT_LENGTH. */
import { and, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";

import type {
  SourceFeedback,
  SourceItem,
  SourceRepository,
  SourceWorkItem,
} from "@/adapters/source";
import type { Database } from "@/db/client";
import {
  feedback,
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

/** The actor recorded on events for links and status changes made from Linear issues. */
export const LINEAR_SYNC_ACTOR = "linear-sync";

/** How much of a description is stored as agent context. */
export const BODY_EXCERPT_LENGTH = 2000;

type SyncResult = {
  workItemId: string;
  /** Requirement keys newly linked from explicit references. */
  linked: string[];
  /** Planned requirements moved to in progress because work on an item linked to them started. */
  started: string[];
  /** Requirements queued for reconciliation. */
  reconcileJobs: number;
  /** Whether a link suggestion was queued, for finished work that references nothing. */
  linkSuggestJob: boolean;
};

/**
 * Store a work item in a project, link the requirements it explicitly references, and queue
 * reconciliation when it has finished.
 *
 * Safe to repeat: replaying the same item creates no duplicate work items, links or jobs. An
 * item older than the stored copy (a delivery that arrived out of order) changes nothing. Started
 * work (an open pull request, or a Linear issue in a started state) moves the planned
 * requirements it is linked to into progress. A reconciliation is queued for each linked
 * requirement when the item first becomes merged (or, for an issue, closed as done), and for each
 * new link added to an item that has already finished. A pull request that merges with no links at
 * all gets a link suggestion job instead, and so does a Linear issue completed inside a Linear
 * project; an explicit link added later supersedes a pending suggestion. An issue that was
 * feedback until its label was removed is withdrawn as feedback. A Linear issue's references are
 * ignored when the project's Linear workspace has a team keyed `TL`, whose issue ids look like
 * requirement keys (see collidesWithRequirementKeys).
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
  const actor = item.source === "linear" ? LINEAR_SYNC_ACTOR : SYNC_ACTOR;
  return db.transaction(async (tx) => {
    if (item.kind === "issue") await withdrawFeedback(tx, projectId, item);
    const fields = {
      kind: item.kind,
      title: item.title,
      url: item.url,
      identifier: item.identifier ?? null,
      state: item.state,
      bodyExcerpt: item.body.slice(0, BODY_EXCERPT_LENGTH),
      people: item.people,
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

    // Where the workspace has a Linear team keyed TL, "Part of TL-12" may name its issue, so
    // links come from suggestions only.
    const referencesIgnored =
      item.source === "linear" &&
      (await tx.$count(
        repositories,
        and(
          eq(repositories.projectId, projectId),
          eq(repositories.source, "linear"),
          eq(repositories.referencesIgnored, true),
        ),
      )) > 0;
    const references = referencesIgnored
      ? []
      : parseReferences(`${item.title}\n${item.body}`);
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
      await applyProposal(tx, proposal.id, actor);
      // The author has now said what this work is for, so a pending guess or agent proposal is
      // out of date.
      await tx
        .update(proposals)
        .set({
          status: "superseded",
          decidedBy: actor,
          decidedAt: new Date(),
        })
        .where(
          and(
            eq(proposals.triggerWorkItemId, workItemId),
            inArray(proposals.source, ["link_suggest", "mcp"]),
            eq(proposals.status, "pending"),
          ),
        );
    }

    const allLinked = [
      ...linkedIds,
      ...newLinks.map((link) => link.requirementId),
    ];
    const started = hasStarted(item)
      ? await startWork(tx, projectId, workItemId, item, allLinked, actor)
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
      await enqueueReconcile(tx, projectId, { workItemId, requirementId });
    }
    // Linear issues outside any project are mostly bugs and chores; suggesting links for them
    // would flood the review queue.
    const suggestLink =
      justFinished &&
      reconcile &&
      (item.kind === "pull_request" || item.inProject === true) &&
      linkedIds.size === 0 &&
      newLinks.length === 0;
    if (suggestLink)
      await enqueue(tx, projectId, "link_suggest", { workItemId });

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
 * Move the planned requirements among `requirementIds` to in progress, because started work
 * references them. Requirements already started, finished, dropped or split are left alone.
 *
 * Like explicit links, this is deterministic, so the proposal is approved at once by the sync,
 * or by the reviewer who approved the link to an open pull request.
 *
 * Returns:
 *   The keys of the requirements that were started.
 */
export async function startWork(
  tx: Transaction,
  projectId: string,
  workItemId: string,
  item: Pick<SourceWorkItem, "source" | "title">,
  requirementIds: string[],
  actor: string,
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
      summary: `Work started on ${keys.join(", ")}: "${item.title}"`,
      rationale:
        item.source === "linear"
          ? "A Linear issue linked to these requirements is in progress, so work on them has started."
          : "An open pull request references these requirements, so work on them has started.",
      operations: keys.map((key) => ({
        type: "set_status",
        requirement_key: key,
        status: "in_progress",
      })),
      triggerWorkItemId: workItemId,
    })
    .returning({ id: proposals.id });
  await applyProposal(tx, proposal.id, actor);
  return keys;
}

/**
 * Store a piece of feedback in a project, and queue the feedback agent the first time it arrives.
 *
 * Safe to repeat: feedback is keyed by (project, source, external id). A delivery older than the
 * stored copy changes nothing. Feedback that had been withdrawn counts again and is sorted again,
 * since its match was superseded when it was withdrawn (or it was withdrawn before it was ever
 * sorted). A copy of the same issue stored as a work item before it was labelled is left as it is.
 *
 * Args:
 *   db: Database to write to.
 *   projectId: Project the feedback belongs to.
 *   item: The feedback as the source reports it.
 *
 * Returns:
 *   The feedback's id, and whether a match job was queued.
 */
export async function syncFeedback(
  db: Database,
  projectId: string,
  item: SourceFeedback,
): Promise<{ feedbackId: string; matchJob: boolean }> {
  return db.transaction(async (tx) => {
    const fields = {
      title: item.title,
      url: item.url,
      bodyExcerpt: item.body.slice(0, BODY_EXCERPT_LENGTH),
      withdrawn: false,
      sourceUpdatedAt: item.updatedAt,
    };
    // Insert first, so a concurrent delivery for the same item waits for this one to commit.
    const [inserted] = await tx
      .insert(feedback)
      .values({
        ...fields,
        projectId,
        source: item.source,
        externalId: item.externalId,
      })
      .onConflictDoNothing()
      .returning({ id: feedback.id });
    if (inserted) {
      await enqueue(tx, projectId, "feedback_match", {
        feedbackId: inserted.id,
      });
      return { feedbackId: inserted.id, matchJob: true };
    }

    const [existing] = await tx
      .select({
        id: feedback.id,
        sourceUpdatedAt: feedback.sourceUpdatedAt,
        withdrawn: feedback.withdrawn,
      })
      .from(feedback)
      .where(
        and(
          eq(feedback.projectId, projectId),
          eq(feedback.source, item.source),
          eq(feedback.externalId, item.externalId),
        ),
      )
      .for("update");
    // Deliveries arrive out of order, as in upsertWorkItem.
    if (existing.sourceUpdatedAt && item.updatedAt < existing.sourceUpdatedAt) {
      return { feedbackId: existing.id, matchJob: false };
    }
    await tx.update(feedback).set(fields).where(eq(feedback.id, existing.id));
    if (existing.withdrawn) {
      await enqueue(tx, projectId, "feedback_match", {
        feedbackId: existing.id,
      });
    }
    return { feedbackId: existing.id, matchJob: existing.withdrawn };
  });
}

/**
 * Sync a work item or piece of feedback into every project its repository is connected to, and
 * record the repository's current name in case it was renamed.
 *
 * Args:
 *   db: Database to write to.
 *   repository: The repository as the source reports it now.
 *   item: The issue, pull request or feedback.
 *
 * An issue delivery older than the issue's stored feedback is skipped: GitHub does not deliver in
 * order, so it is from before the label was added and must not create a work item for feedback.
 *
 * Returns:
 *   How many connected projects it was synced into; 0 if the repository is not connected.
 */
export async function syncRepositoryItem(
  db: Database,
  repository: SourceRepository,
  item: SourceItem,
): Promise<number> {
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
  for (const { projectId } of connected) {
    if (item.kind === "feedback") await syncFeedback(db, projectId, item);
    else if (!(await hasNewerFeedback(db, projectId, item))) {
      await syncWorkItem(db, projectId, item);
    }
  }
  return connected.length;
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

/**
 * Whether work on a work item has started: an open pull request, or an open Linear issue in a
 * started state such as In Progress.
 *
 * Args:
 *   item: The work item as the source reports it.
 *
 * Returns:
 *   True when the planned requirements it is linked to should move to in progress.
 */
export function hasStarted(item: SourceWorkItem): boolean {
  return (
    item.state === "open" &&
    (item.kind === "pull_request" || item.started === true)
  );
}

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Mark feedback withdrawn when its source now reports it as an ordinary issue (the label was
 * removed), and supersede its pending match. Does nothing when the issue was never feedback, is
 * already withdrawn, or this delivery is older than the stored feedback.
 */
async function withdrawFeedback(
  tx: Transaction,
  projectId: string,
  item: SourceWorkItem,
): Promise<void> {
  const [withdrawn] = await tx
    .update(feedback)
    .set({ withdrawn: true, sourceUpdatedAt: item.updatedAt })
    .where(
      and(
        eq(feedback.projectId, projectId),
        eq(feedback.source, item.source),
        eq(feedback.externalId, item.externalId),
        eq(feedback.withdrawn, false),
        or(
          isNull(feedback.sourceUpdatedAt),
          lte(feedback.sourceUpdatedAt, item.updatedAt),
        ),
      ),
    )
    .returning({ id: feedback.id });
  if (!withdrawn) return;
  await tx
    .update(proposals)
    .set({ status: "superseded", decidedBy: SYNC_ACTOR, decidedAt: new Date() })
    .where(
      and(
        eq(proposals.triggerFeedbackId, withdrawn.id),
        eq(proposals.source, "feedback_match"),
        eq(proposals.status, "pending"),
      ),
    );
}

/** Whether the project holds this issue as feedback, from a delivery newer than this one. */
async function hasNewerFeedback(
  db: Database,
  projectId: string,
  item: SourceWorkItem,
): Promise<boolean> {
  const newer = await db.$count(
    feedback,
    and(
      eq(feedback.projectId, projectId),
      eq(feedback.source, item.source),
      eq(feedback.externalId, item.externalId),
      eq(feedback.withdrawn, false),
      gt(feedback.sourceUpdatedAt, item.updatedAt),
    ),
  );
  return newer > 0;
}

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
