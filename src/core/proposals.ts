/** Approve or reject proposals. applyProposal is the only code path that changes the graph. Exports applyProposal, rejectProposal, ProposalError. */
import { and, eq } from "drizzle-orm";

import type { Database } from "@/db/client";
import {
  events,
  links,
  outcomes,
  proposals,
  requirements,
  workItems,
} from "@/db/schema";

import { type GraphOperation, operationListSchema } from "./operations";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** The event fields an operation produces. Project, actor and proposal are added by the caller. */
type OperationEvent = Pick<
  typeof events.$inferInsert,
  "type" | "entityType" | "entityId" | "payload" | "productNote"
>;

/** A proposal cannot be decided, or one of its operations does not fit the current graph. */
export class ProposalError extends Error {
  name = "ProposalError";
}

/**
 * Apply every operation in a pending proposal in one transaction and mark it approved.
 *
 * Writes one event per operation. If any operation fails, nothing changes.
 *
 * Args:
 *   db: Database to write to.
 *   proposalId: The proposal to approve.
 *   actor: User id of the person approving it.
 *
 * Raises:
 *   ProposalError: The proposal is missing or not pending, or an operation is invalid for the current graph.
 *   ZodError: The stored operations do not match the operation schema.
 */
export async function applyProposal(
  db: Database,
  proposalId: string,
  actor: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const proposal = await lockPendingProposal(tx, proposalId);
    const operations = operationListSchema.parse(proposal.operations);

    for (const operation of operations) {
      const event = await applyOperation(tx, proposal.projectId, operation);
      await tx.insert(events).values({
        ...event,
        projectId: proposal.projectId,
        actor,
        proposalId,
      });
    }

    await tx
      .update(proposals)
      .set({ status: "approved", decidedBy: actor, decidedAt: new Date() })
      .where(eq(proposals.id, proposalId));
  });
}

/**
 * Mark a pending proposal rejected. The graph is not touched.
 *
 * Args:
 *   db: Database to write to.
 *   proposalId: The proposal to reject.
 *   actor: User id of the person rejecting it.
 *
 * Raises:
 *   ProposalError: The proposal is missing or not pending.
 */
export async function rejectProposal(
  db: Database,
  proposalId: string,
  actor: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await lockPendingProposal(tx, proposalId);
    await tx
      .update(proposals)
      .set({ status: "rejected", decidedBy: actor, decidedAt: new Date() })
      .where(eq(proposals.id, proposalId));
  });
}

async function lockPendingProposal(tx: Transaction, proposalId: string) {
  // Row lock so two people approving at once cannot both apply it.
  const [proposal] = await tx
    .select()
    .from(proposals)
    .where(eq(proposals.id, proposalId))
    .for("update");
  if (!proposal) throw new ProposalError(`Proposal ${proposalId} not found`);
  if (proposal.status !== "pending") {
    throw new ProposalError(
      `Proposal ${proposalId} is ${proposal.status}, not pending`,
    );
  }
  return proposal;
}

async function applyOperation(
  tx: Transaction,
  projectId: string,
  op: GraphOperation,
): Promise<OperationEvent> {
  switch (op.type) {
    case "create_outcome": {
      const [outcome] = await tx
        .insert(outcomes)
        .values({
          projectId,
          key: op.key,
          title: op.title,
          description: op.description,
          target: op.target,
          priority: op.priority,
        })
        .returning();
      return event(op, "outcome", outcome.id, null);
    }

    case "update_outcome": {
      const outcome = await findOutcome(tx, projectId, op.outcome_key);
      await tx
        .update(outcomes)
        .set({
          title: op.title,
          description: op.description,
          target: op.target,
          priority: op.priority,
        })
        .where(eq(outcomes.id, outcome.id));
      return event(op, "outcome", outcome.id, null);
    }

    case "create_requirement": {
      const outcome = await findOutcome(tx, projectId, op.outcome_key);
      const [requirement] = await tx
        .insert(requirements)
        .values({
          projectId,
          key: op.key,
          outcomeId: outcome.id,
          title: op.title,
          description: op.description,
          status: "planned",
          userVisible: op.user_visible,
          productNote: op.product_note,
        })
        .returning();
      return event(op, "requirement", requirement.id, op.product_note);
    }

    case "split_requirement": {
      const parent = await findLeaf(tx, projectId, op.requirement_key);
      // The parent keeps its own outcome or parent link; only its status moves to the children.
      await tx
        .update(requirements)
        .set({ status: null, splitReason: op.split_reason })
        .where(eq(requirements.id, parent.id));
      await tx.insert(requirements).values(
        op.children.map((child) => ({
          projectId,
          key: child.key,
          parentId: parent.id,
          title: child.title,
          description: child.description,
          status: child.status,
          userVisible: child.user_visible,
        })),
      );
      return event(op, "requirement", parent.id, op.product_note);
    }

    case "update_requirement": {
      const requirement = await findRequirement(
        tx,
        projectId,
        op.requirement_key,
      );
      await tx
        .update(requirements)
        .set({
          title: op.title,
          description: op.description,
          userVisible: op.user_visible,
          productNote: op.product_note,
        })
        .where(eq(requirements.id, requirement.id));
      return event(op, "requirement", requirement.id, op.product_note);
    }

    case "set_status": {
      const leaf = await findLeaf(tx, projectId, op.requirement_key);
      await tx
        .update(requirements)
        .set({ status: op.status })
        .where(eq(requirements.id, leaf.id));
      return event(op, "requirement", leaf.id, op.product_note);
    }

    case "link_work_item": {
      const requirement = await findRequirement(
        tx,
        projectId,
        op.requirement_key,
      );
      await findWorkItem(tx, projectId, op.work_item_id);
      await tx.insert(links).values({
        requirementId: requirement.id,
        workItemId: op.work_item_id,
        relation: op.relation,
        confidence: op.confidence,
      });
      // Links have no id of their own; the event belongs to the requirement.
      return event(op, "requirement", requirement.id, null);
    }

    case "unlink_work_item": {
      const requirement = await findRequirement(
        tx,
        projectId,
        op.requirement_key,
      );
      const removed = await tx
        .delete(links)
        .where(
          and(
            eq(links.requirementId, requirement.id),
            eq(links.workItemId, op.work_item_id),
          ),
        )
        .returning();
      if (removed.length === 0) {
        throw new ProposalError(
          `${op.requirement_key} is not linked to work item ${op.work_item_id}`,
        );
      }
      return event(op, "requirement", requirement.id, null);
    }
  }
}

function event(
  op: GraphOperation,
  entityType: "outcome" | "requirement",
  entityId: string,
  productNote: string | null | undefined,
): OperationEvent {
  return {
    type: op.type,
    entityType,
    entityId,
    payload: op,
    productNote: productNote ?? null,
  };
}

async function findOutcome(tx: Transaction, projectId: string, key: string) {
  const [outcome] = await tx
    .select()
    .from(outcomes)
    .where(and(eq(outcomes.projectId, projectId), eq(outcomes.key, key)));
  if (!outcome) throw new ProposalError(`Outcome ${key} not found`);
  return outcome;
}

async function findRequirement(
  tx: Transaction,
  projectId: string,
  key: string,
) {
  const [requirement] = await tx
    .select()
    .from(requirements)
    .where(
      and(eq(requirements.projectId, projectId), eq(requirements.key, key)),
    );
  if (!requirement) throw new ProposalError(`Requirement ${key} not found`);
  return requirement;
}

async function findLeaf(tx: Transaction, projectId: string, key: string) {
  const requirement = await findRequirement(tx, projectId, key);
  // Only leaves carry a status, so a null status means the requirement has children.
  if (requirement.status === null) {
    throw new ProposalError(
      `Requirement ${key} has been split; change its children instead`,
    );
  }
  return requirement;
}

async function findWorkItem(tx: Transaction, projectId: string, id: string) {
  const [workItem] = await tx
    .select({ id: workItems.id })
    .from(workItems)
    .where(and(eq(workItems.projectId, projectId), eq(workItems.id, id)));
  if (!workItem) throw new ProposalError(`Work item ${id} not found`);
  return workItem;
}
