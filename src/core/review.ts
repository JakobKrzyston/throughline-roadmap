/** What happens when a person approves a proposal in the review queue. Exports approveProposal. */
import { and, eq, inArray } from "drizzle-orm";

import type { Database } from "@/db/client";
import { proposals, requirements, workItems } from "@/db/schema";
import { enqueueReconcile } from "@/jobs/queue";

import { operationListSchema } from "./operations";
import { applyProposal } from "./proposals";
import { isFinished } from "./work-items";

/**
 * Apply a proposal for a reviewer, and queue reconciliation for any finished work it links.
 *
 * Linking a merged pull request to a requirement, as an approved link suggestion does, means the
 * requirement has new finished work to compare against the plan, just as when a pull request
 * that references it merges.
 *
 * Args:
 *   db: Database to write to.
 *   proposalId: The proposal to approve.
 *   actor: The reviewer.
 *   editedOperations: The reviewer's edited operations, if they changed any (see applyProposal).
 *
 * Returns:
 *   How many requirements were queued for reconciliation.
 *
 * Raises:
 *   ProposalError, ZodError: As applyProposal; nothing is applied or queued.
 */
export async function approveProposal(
  db: Database,
  proposalId: string,
  actor: string,
  editedOperations?: unknown,
): Promise<number> {
  return db.transaction(async (tx) => {
    await applyProposal(tx, proposalId, actor, editedOperations);

    const [proposal] = await tx
      .select()
      .from(proposals)
      .where(eq(proposals.id, proposalId));
    const linksAdded = operationListSchema
      .parse(proposal.operations)
      .flatMap((op) => (op.type === "link_work_item" ? [op] : []));
    if (linksAdded.length === 0) return 0;

    const items = await tx
      .select()
      .from(workItems)
      .where(
        inArray(
          workItems.id,
          linksAdded.map((op) => op.work_item_id),
        ),
      );
    let queued = 0;
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
