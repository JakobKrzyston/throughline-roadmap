/** A person's own changes from the plan page: reorder outcomes and change targets, saved as proposals they approve as they make them. Exports moveOperations, outcomeTargetOperations, savePlanningChange. */
import type { Database } from "@/db/client";
import { proposals } from "@/db/schema";

import type { GraphOperationInput } from "./operations";
import { applyProposal } from "./proposals";
import { formatTarget } from "./schedule";

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
 * The operation that changes an outcome's target, with a note saying what moved.
 *
 * Args:
 *   outcome: The outcome's key and current target.
 *   target: The new target, or null to clear it.
 *   reason: Optional plain-language reason, added to the note.
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
  const note =
    target === null
      ? "The target date was removed."
      : outcome.target === null
        ? `Now planned for ${formatTarget(target)}.`
        : `Moved from ${formatTarget(outcome.target)} to ${formatTarget(target)}.`;
  return [
    {
      type: "update_outcome",
      outcome_key: outcome.key,
      target,
      product_note: withReason(note, reason),
    },
  ];
}

/**
 * Save a person's change as a proposal and approve it for them at once.
 *
 * Manual edits take the same path as agent proposals, so applyProposal stays the only code that
 * changes the graph and every change has an event with its actor.
 *
 * Args:
 *   db: Database to write to.
 *   projectId: The project.
 *   summary: One plain-language line describing the change.
 *   operations: What to change.
 *   actor: The person making it.
 *
 * Returns:
 *   The approved proposal's id.
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
): Promise<string> {
  return db.transaction(async (tx) => {
    const [proposal] = await tx
      .insert(proposals)
      .values({ projectId, source: "manual", summary, operations })
      .returning({ id: proposals.id });
    await applyProposal(tx, proposal.id, actor);
    return proposal.id;
  });
}

function withReason(note: string, reason: string | undefined): string {
  const trimmed = reason?.trim();
  return trimmed ? `${note} ${trimmed}` : note;
}
