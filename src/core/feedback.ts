/** Customer feedback on the roadmap: groups it by outcome and theme, and links it to outcomes by hand. Syncing it from sources is in work-items.ts. Exports groupFeedback, loadFeedbackBoard, saveFeedbackLink, FeedbackBoard, FeedbackView. */
import { and, asc, desc, eq } from "drizzle-orm";

import type { Database } from "@/db/client";
import { feedback, feedbackLinks, outcomes, proposals } from "@/db/schema";

import { applyProposal } from "./proposals";

/** One piece of feedback as the feedback page shows it. */
export type FeedbackView = {
  id: string;
  title: string;
  url: string;
  theme: string | null;
  receivedAt: Date;
};

/** A project's feedback, grouped for the feedback page. */
export type FeedbackBoard = {
  /** Every live outcome with the feedback linked to it, most asked-for first. */
  outcomes: { key: string; title: string; feedback: FeedbackView[] }[];
  /** Unlinked feedback the agent has matched to an outcome, waiting in the review queue. */
  inReview: (FeedbackView & { outcomeKey: string })[];
  /**
   * Unlinked feedback with no match waiting: what customers ask for that the roadmap does not
   * cover. Grouped by theme, largest group first; feedback not yet sorted has a null theme and
   * comes last.
   */
  gaps: { theme: string | null; feedback: FeedbackView[] }[];
};

/**
 * Group feedback for the feedback page. Pure, so the grouping rules are tested without a database.
 *
 * Args:
 *   input.outcomes: Live outcomes in priority order.
 *   input.feedback: Feedback that is not withdrawn, newest first.
 *   input.links: Which outcome each piece of feedback is linked to, by outcome id.
 *   input.pendingMatches: The outcome key of each pending match, by feedback id.
 *
 * Returns:
 *   The board. Outcomes with the same amount of feedback keep their priority order. Feedback
 *   linked to an outcome that is not live counts as unlinked.
 */
export function groupFeedback(input: {
  outcomes: { id: string; key: string; title: string }[];
  feedback: FeedbackView[];
  links: { feedbackId: string; outcomeId: string }[];
  pendingMatches: Map<string, string>;
}): FeedbackBoard {
  const linked = new Set<string>();
  const byOutcome = new Map<string, FeedbackView[]>(
    input.outcomes.map((outcome) => [outcome.id, []]),
  );
  const byId = new Map(input.feedback.map((item) => [item.id, item]));
  for (const link of input.links) {
    const item = byId.get(link.feedbackId);
    const list = byOutcome.get(link.outcomeId);
    if (!item || !list) continue;
    list.push(item);
    linked.add(item.id);
  }
  // Keep each outcome's list newest first, like the input.
  const order = new Map(input.feedback.map((item, i) => [item.id, i]));
  for (const list of byOutcome.values()) {
    list.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  }

  const inReview: FeedbackBoard["inReview"] = [];
  const gapsByTheme = new Map<string | null, FeedbackView[]>();
  for (const item of input.feedback) {
    if (linked.has(item.id)) continue;
    const outcomeKey = input.pendingMatches.get(item.id);
    if (outcomeKey) {
      inReview.push({ ...item, outcomeKey });
      continue;
    }
    const theme = item.theme?.toLowerCase() ?? null;
    gapsByTheme.set(theme, [...(gapsByTheme.get(theme) ?? []), item]);
  }

  return {
    outcomes: input.outcomes
      .map((outcome) => ({
        key: outcome.key,
        title: outcome.title,
        feedback: byOutcome.get(outcome.id)!,
      }))
      // Array.prototype.sort is stable, so ties keep priority order.
      .sort((a, b) => b.feedback.length - a.feedback.length),
    inReview,
    gaps: [...gapsByTheme.values()]
      .map((list) => ({ theme: list[0].theme, feedback: list }))
      .sort(
        (a, b) =>
          Number(a.theme === null) - Number(b.theme === null) ||
          b.feedback.length - a.feedback.length,
      ),
  };
}

/**
 * Load a project's feedback, grouped by outcome, waiting for review, and not on the roadmap.
 *
 * Args:
 *   db: Database to read.
 *   projectId: The project.
 *
 * Returns:
 *   The board (see groupFeedback). Withdrawn feedback is left out.
 */
export async function loadFeedbackBoard(
  db: Database,
  projectId: string,
): Promise<FeedbackBoard> {
  const [outcomeRows, feedbackRows, linkRows, pendingRows] = await Promise.all([
    db
      .select({ id: outcomes.id, key: outcomes.key, title: outcomes.title })
      .from(outcomes)
      .where(
        and(eq(outcomes.projectId, projectId), eq(outcomes.archived, false)),
      )
      .orderBy(asc(outcomes.priority), asc(outcomes.key)),
    db
      .select({
        id: feedback.id,
        title: feedback.title,
        url: feedback.url,
        theme: feedback.theme,
        receivedAt: feedback.createdAt,
      })
      .from(feedback)
      .where(
        and(eq(feedback.projectId, projectId), eq(feedback.withdrawn, false)),
      )
      .orderBy(desc(feedback.createdAt), asc(feedback.id)),
    db
      .select({
        feedbackId: feedbackLinks.feedbackId,
        outcomeId: feedbackLinks.outcomeId,
      })
      .from(feedbackLinks)
      .innerJoin(feedback, eq(feedbackLinks.feedbackId, feedback.id))
      .where(eq(feedback.projectId, projectId)),
    db
      .select({
        feedbackId: proposals.triggerFeedbackId,
        operations: proposals.operations,
      })
      .from(proposals)
      .where(
        and(
          eq(proposals.projectId, projectId),
          eq(proposals.source, "feedback_match"),
          eq(proposals.status, "pending"),
        ),
      ),
  ]);
  const pendingMatches = new Map<string, string>();
  for (const row of pendingRows) {
    const [op] = row.operations;
    if (row.feedbackId && op?.type === "link_feedback") {
      pendingMatches.set(row.feedbackId, op.outcome_key);
    }
  }
  return groupFeedback({
    outcomes: outcomeRows,
    feedback: feedbackRows,
    links: linkRows,
    pendingMatches,
  });
}

/**
 * Link feedback to an outcome, or unlink it, as a person's own change: a `manual` proposal
 * approved as it is made, so it has an event like every other graph change. Linking supersedes
 * the feedback's pending match, since the person has decided where it belongs.
 *
 * Args:
 *   db: Database to write to.
 *   projectId: The project.
 *   change: The feedback, the outcome's key, and whether to link or unlink.
 *   actor: Who made the change.
 *
 * Raises:
 *   ProposalError: The outcome or feedback is missing, or it is already linked (or, to unlink,
 *     not linked).
 */
export async function saveFeedbackLink(
  db: Database,
  projectId: string,
  change: { feedbackId: string; outcomeKey: string; link: boolean },
  actor: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [item] = await tx
      .select({ title: feedback.title })
      .from(feedback)
      .where(
        and(
          eq(feedback.projectId, projectId),
          eq(feedback.id, change.feedbackId),
        ),
      );
    const title = item?.title ?? "feedback";
    const [proposal] = await tx
      .insert(proposals)
      .values({
        projectId,
        source: "manual",
        summary: change.link
          ? `Link feedback "${title}" to ${change.outcomeKey}`
          : `Unlink feedback "${title}" from ${change.outcomeKey}`,
        operations: [
          {
            type: change.link ? "link_feedback" : "unlink_feedback",
            outcome_key: change.outcomeKey,
            feedback_id: change.feedbackId,
          },
        ],
        triggerFeedbackId: item ? change.feedbackId : null,
      })
      .returning({ id: proposals.id });
    await applyProposal(tx, proposal.id, actor);
    if (!change.link) return;
    await tx
      .update(proposals)
      .set({ status: "superseded", decidedBy: actor, decidedAt: new Date() })
      .where(
        and(
          eq(proposals.triggerFeedbackId, change.feedbackId),
          eq(proposals.source, "feedback_match"),
          eq(proposals.status, "pending"),
        ),
      );
  });
}
