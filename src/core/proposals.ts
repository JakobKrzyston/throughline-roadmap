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
import { describeTargetMove } from "./schedule";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Proposal = typeof proposals.$inferSelect;
type Outcome = typeof outcomes.$inferSelect;
type Requirement = typeof requirements.$inferSelect;

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
 *   editedOperations: The reviewer's edited copy of the operations, applied and stored in place of
 *     the originals. Edits may change wording and values but not what the proposal touches.
 *
 * Raises:
 *   ProposalError: The proposal is missing or not pending, an edit changes what it touches, or an
 *     operation is invalid for the current graph.
 *   ZodError: The stored or edited operations do not match the operation schema.
 */
export async function applyProposal(
  db: Database,
  proposalId: string,
  actor: string,
  editedOperations?: unknown,
): Promise<void> {
  await db.transaction(async (tx) => {
    const proposal = await lockPendingProposal(tx, proposalId);
    let operations = operationListSchema.parse(proposal.operations);
    if (editedOperations !== undefined) {
      const edited = operationListSchema.parse(editedOperations);
      // JSON keeps the parts apart, so no key can be crafted to match a different structure.
      const targets = (ops: GraphOperation[]) =>
        JSON.stringify(ops.map(targetOf));
      if (targets(edited) !== targets(operations)) {
        throw new ProposalError(
          "An edit can change wording and values, but not what the proposal changes",
        );
      }
      operations = edited;
      await tx
        .update(proposals)
        .set({ operations })
        .where(eq(proposals.id, proposalId));
    }

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

async function lockPendingProposal(
  tx: Transaction,
  proposalId: string,
): Promise<Proposal> {
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
        .onConflictDoNothing()
        .returning();
      if (!outcome) throw new ProposalError(`Outcome key ${op.key} is in use`);
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
      // Written from the target the outcome had, so an edited proposal or one made against an
      // older plan cannot put a move that did not happen in the change feed.
      const move =
        op.target === undefined
          ? null
          : describeTargetMove(outcome.target, op.target);
      const note = [move, op.product_note].filter(Boolean).join(" ");
      return event(op, "outcome", outcome.id, note || null);
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
          target: op.target,
        })
        .onConflictDoNothing()
        .returning();
      if (!requirement) {
        throw new ProposalError(`Requirement key ${op.key} is in use`);
      }
      return event(op, "requirement", requirement.id, op.product_note);
    }

    case "split_requirement": {
      const parent = await findLeaf(tx, projectId, op.requirement_key);
      // The parent keeps its own outcome or parent link; only its status moves to the children.
      await tx
        .update(requirements)
        .set({ status: null, splitReason: op.split_reason })
        .where(eq(requirements.id, parent.id));
      const children = await tx
        .insert(requirements)
        .values(
          op.children.map((child) => ({
            projectId,
            key: child.key,
            parentId: parent.id,
            title: child.title,
            description: child.description,
            status: child.status,
            userVisible: child.user_visible,
          })),
        )
        .onConflictDoNothing()
        .returning({ key: requirements.key });
      if (children.length < op.children.length) {
        const created = new Set(children.map((child) => child.key));
        const taken = op.children
          .map((child) => child.key)
          .filter((key) => !created.has(key));
        throw new ProposalError(
          `Requirement key ${taken.join(", ")} is in use`,
        );
      }
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
          target: op.target,
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
      const linked = await tx
        .insert(links)
        .values({
          requirementId: requirement.id,
          workItemId: op.work_item_id,
          relation: op.relation,
          confidence: op.confidence,
        })
        .onConflictDoNothing()
        .returning();
      if (linked.length === 0) {
        throw new ProposalError(
          `${op.requirement_key} is already linked to work item ${op.work_item_id}`,
        );
      }
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

/** What an operation acts on, ignoring the values it sets. Two operations with the same target differ only in wording or values. */
function targetOf(op: GraphOperation): unknown[] {
  switch (op.type) {
    case "create_outcome":
      return [op.type, op.key];
    case "update_outcome":
      return [op.type, op.outcome_key];
    case "create_requirement":
      return [op.type, op.key, op.outcome_key];
    case "split_requirement":
      return [
        op.type,
        op.requirement_key,
        op.children.map((child) => child.key),
      ];
    case "update_requirement":
    case "set_status":
      return [op.type, op.requirement_key];
    case "link_work_item":
      return [op.type, op.requirement_key, op.work_item_id, op.confidence];
    case "unlink_work_item":
      return [op.type, op.requirement_key, op.work_item_id];
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

async function findOutcome(
  tx: Transaction,
  projectId: string,
  key: string,
): Promise<Outcome> {
  // Row lock so the target read here is still the target when the event describes the move.
  const [outcome] = await tx
    .select()
    .from(outcomes)
    .where(and(eq(outcomes.projectId, projectId), eq(outcomes.key, key)))
    .for("update");
  if (!outcome) throw new ProposalError(`Outcome ${key} not found`);
  return outcome;
}

async function findRequirement(
  tx: Transaction,
  projectId: string,
  key: string,
): Promise<Requirement> {
  // Row lock so a concurrent proposal cannot split or re-status it between this check and our write.
  const [requirement] = await tx
    .select()
    .from(requirements)
    .where(
      and(eq(requirements.projectId, projectId), eq(requirements.key, key)),
    )
    .for("update");
  if (!requirement) throw new ProposalError(`Requirement ${key} not found`);
  return requirement;
}

async function findLeaf(
  tx: Transaction,
  projectId: string,
  key: string,
): Promise<Requirement> {
  const requirement = await findRequirement(tx, projectId, key);
  // Only leaves carry a status, so a null status means the requirement has children.
  if (requirement.status === null) {
    throw new ProposalError(
      `Requirement ${key} has been split; change its children instead`,
    );
  }
  return requirement;
}

async function findWorkItem(
  tx: Transaction,
  projectId: string,
  id: string,
): Promise<{ id: string }> {
  const [workItem] = await tx
    .select({ id: workItems.id })
    .from(workItems)
    .where(and(eq(workItems.projectId, projectId), eq(workItems.id, id)));
  if (!workItem) throw new ProposalError(`Work item ${id} not found`);
  return workItem;
}
