/** A person's own changes from the plan page: reorder outcomes and change targets, saved as proposals they approve as they make them. Exports moveOperations, outcomeTargetOperations, supersedeReschedules, savePlanningChange. */
import { and, eq, sql } from "drizzle-orm";

import type { Database } from "@/db/client";
import { outcomes, proposals, requirements } from "@/db/schema";
import { enqueueSlipCheck } from "@/jobs/queue";

import { type GraphOperationInput, operationListSchema } from "./operations";
import { applyProposal } from "./proposals";
import { outcomeIdOf } from "./roadmap";

/**
 * The operations that move one outcome to a new place in the priority order.
 *
 * Priorities are renumbered 1, 2, 3… in the new order, and only outcomes whose number changes
 * get an operation. Only the moved outcome gets a product note, so a move is one entry in the
 * change feed rather than one per renumbered outcome.
 *
 * Args:
 *   ordered: Live outcomes in their current order, highest priority first.
 *   key: The outcome to move.
 *   toIndex: Its new position, 0 for the top. Out-of-range positions are clamped.
 *
 * Returns:
 *   The update_outcome operations, empty when the outcome is not found or does not move.
 */
export function moveOperations(
  ordered: { key: string; title: string; priority: number }[],
  key: string,
  toIndex: number,
): GraphOperationInput[] {
  const from = ordered.findIndex((outcome) => outcome.key === key);
  if (from === -1) return [];
  const to = Math.max(0, Math.min(toIndex, ordered.length - 1));
  if (to === from) return [];

  const order = ordered.filter((outcome) => outcome.key !== key);
  order.splice(to, 0, ordered[from]);
  const note =
    to < from
      ? `Now comes before “${order[to + 1].title}”.`
      : `Now comes after “${order[to - 1].title}”.`;

  return order.flatMap((outcome, i): GraphOperationInput[] => {
    const moved = outcome.key === key;
    if (!moved && outcome.priority === i + 1) return [];
    return [
      {
        type: "update_outcome",
        outcome_key: outcome.key,
        priority: i + 1,
        ...(moved ? { product_note: note } : {}),
      },
    ];
  });
}

/**
 * The operation that changes an outcome's target.
 *
 * The note for the change feed is written when the change is applied, from the target the
 * outcome has then (see applyProposal), so only the reason is stored here.
 *
 * Args:
 *   outcome: The outcome's key and current target.
 *   target: The new target, or null to clear it.
 *   reason: Optional plain-language reason, added after "Moved from … to …" in the feed.
 *
 * Returns:
 *   One update_outcome operation, or none when the target does not change.
 */
export function outcomeTargetOperations(
  outcome: { key: string; target: string | null },
  target: string | null,
  reason?: string,
): GraphOperationInput[] {
  if (target === outcome.target) return [];
  const trimmed = reason?.trim();
  return [
    {
      type: "update_outcome",
      outcome_key: outcome.key,
      target,
      ...(trimmed ? { product_note: trimmed } : {}),
    },
  ];
}

/**
 * Mark the pending reschedule proposals for an outcome superseded.
 *
 * Args:
 *   tx: Transaction to write in.
 *   projectId: The project.
 *   outcomeKey: The outcome whose schedule changed.
 *   actor: Who or what made them out of date.
 */
export async function supersedeReschedules(
  tx: Database,
  projectId: string,
  outcomeKey: string,
  actor: string,
): Promise<void> {
  await tx
    .update(proposals)
    .set({ status: "superseded", decidedBy: actor, decidedAt: new Date() })
    .where(
      and(
        eq(proposals.projectId, projectId),
        eq(proposals.source, "reschedule"),
        eq(proposals.status, "pending"),
        sql`${proposals.operations} @> ${JSON.stringify([{ outcome_key: outcomeKey }])}::jsonb`,
      ),
    );
}

/**
 * Save a person's change as a proposal and approve it for them at once.
 *
 * Manual edits take the same path as agent proposals, so applyProposal stays the only code that
 * changes the graph and every change has an event with its actor. A change to an outcome's or a
 * requirement's target makes any pending reschedule proposal for that outcome out of date, so
 * those are superseded and the outcome's schedule is checked again.
 *
 * Args:
 *   db: Database to write to.
 *   projectId: The project.
 *   summary: One plain-language line describing the change.
 *   operations: What to change.
 *   actor: The person making it.
 *
 * Returns:
 *   The approved proposal's id, and how many slip checks were queued.
 *
 * Raises:
 *   ProposalError, ZodError: As applyProposal; nothing is saved.
 */
export async function savePlanningChange(
  db: Database,
  projectId: string,
  summary: string,
  operations: GraphOperationInput[],
  actor: string,
): Promise<{ proposalId: string; checksQueued: number }> {
  return db.transaction(async (tx) => {
    const [proposal] = await tx
      .insert(proposals)
      .values({ projectId, source: "manual", summary, operations })
      .returning({ id: proposals.id });
    await applyProposal(tx, proposal.id, actor);

    const rescheduled = new Set<string>();
    for (const op of operationListSchema.parse(operations)) {
      if (op.type === "update_outcome" && op.target !== undefined) {
        const [outcome] = await tx
          .select({ id: outcomes.id })
          .from(outcomes)
          .where(
            and(
              eq(outcomes.projectId, projectId),
              eq(outcomes.key, op.outcome_key),
            ),
          );
        rescheduled.add(outcome.id);
      } else if (op.type === "update_requirement" && op.target !== undefined) {
        const [requirement] = await tx
          .select({ id: requirements.id })
          .from(requirements)
          .where(
            and(
              eq(requirements.projectId, projectId),
              eq(requirements.key, op.requirement_key),
            ),
          );
        rescheduled.add(await outcomeIdOf(tx, requirement.id));
      }
    }

    let checksQueued = 0;
    for (const outcomeId of rescheduled) {
      const [outcome] = await tx
        .select({ key: outcomes.key })
        .from(outcomes)
        .where(eq(outcomes.id, outcomeId));
      await supersedeReschedules(tx, projectId, outcome.key, actor);
      if (await enqueueSlipCheck(tx, { outcomeId })) checksQueued++;
    }
    return { proposalId: proposal.id, checksQueued };
  });
}
