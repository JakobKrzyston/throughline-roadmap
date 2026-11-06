/** What happens when a person approves a proposal in the review queue. Exports approveProposal. */
import { and, eq, inArray } from "drizzle-orm";

import type { Database } from "@/db/client";
import { proposals, requirements, workItems } from "@/db/schema";
import { enqueueReconcile, enqueueSlipCheck } from "@/jobs/queue";

import { operationListSchema } from "./operations";
import { applyProposal } from "./proposals";
import { outcomeIdOf } from "./roadmap";
import { isFinished } from "./work-items";

/**
 * Apply a proposal for a reviewer, and queue the agent work it leads to.
 *
 * Linking a merged pull request to a requirement, as an approved link suggestion does, means the
 * requirement has new finished work to compare against the plan, just as when a pull request
 * that references it merges. An approved reconciliation changes what is left to do under an
 * outcome, so the outcome's target is checked again.
 *
 * Args:
 *   db: Database to write to.
 *   proposalId: The proposal to approve.
 *   actor: The reviewer.
 *   editedOperations: The reviewer's edited operations, if they changed any (see applyProposal).
 *   mappingDecisions: A paired import's moves and placements (see applyProposal).
 *
 * Returns:
 *   How many jobs were queued.
 *
 * Raises:
 *   ProposalError, ZodError: As applyProposal; nothing is applied or queued.
 */
export async function approveProposal(
  db: Database,
  proposalId: string,
  actor: string,
  editedOperations?: unknown,
  mappingDecisions?: unknown,
): Promise<number> {
  return db.transaction(async (tx) => {
    await applyProposal(
      tx,
      proposalId,
      actor,
      editedOperations,
      mappingDecisions,
    );

    const [proposal] = await tx
      .select()
      .from(proposals)
      .where(eq(proposals.id, proposalId));
    let queued = 0;
    if (proposal.source === "reconcile" && proposal.requirementId) {
      const outcomeId = await outcomeIdOf(tx, proposal.requirementId);
      if (await enqueueSlipCheck(tx, { outcomeId })) queued++;
    }

    const linksAdded = operationListSchema
      .parse(proposal.operations)
      .flatMap((op) => (op.type === "link_work_item" ? [op] : []));
    if (linksAdded.length === 0) return queued;

    const items = await tx
      .select()
      .from(workItems)
      .where(
        inArray(
          workItems.id,
          linksAdded.map((op) => op.work_item_id),
        ),
      );
    for (const op of linksAdded) {
      const item = items.find((row) => row.id === op.work_item_id)!;
      if (!isFinished(item)) continue;
      const [requirement] = await tx
        .select({ id: requirements.id })
        .from(requirements)
        .where(
          and(
            eq(requirements.projectId, proposal.projectId),
            eq(requirements.key, op.requirement_key),
          ),
        );
      await enqueueReconcile(tx, {
        workItemId: item.id,
        requirementId: requirement.id,
      });
      queued++;
    }
    return queued;
  });
}
