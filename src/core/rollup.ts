/** Pure progress and product-status rollups over a requirement tree. Exports requirementProgress, outcomeProgress, productStatus. */
import type { LeafStatus } from "./operations";

/** The parts of a requirement the rollup needs. A node with no children is a leaf. */
export interface RequirementNode {
  /** Set on leaves; null on parents. */
  status: LeafStatus | null;
  userVisible: boolean;
  children: RequirementNode[];
}

export type ProductStatus =
  "not_started" | "in_progress" | "partially_available" | "delivered";

/**
 * Collect the leaves under some requirements that count toward progress, skipping dropped ones.
 *
 * Args:
 *   nodes: Requirements to walk, e.g. an outcome's root requirements.
 *
 * Returns:
 *   Every non-dropped leaf at any depth.
 */
function countedLeaves(nodes: RequirementNode[]): RequirementNode[] {
  return nodes.flatMap((node) => {
    if (node.children.length > 0) return countedLeaves(node.children);
    return node.status === "dropped" ? [] : [node];
  });
}

/**
 * Share of counted leaves that are done. Every leaf counts equally.
 *
 * Args:
 *   nodes: Requirements to measure.
 *
 * Returns:
 *   A number from 0 to 1. Zero when there is nothing to count.
 */
function progressOf(nodes: RequirementNode[]): number {
  const leaves = countedLeaves(nodes);
  if (leaves.length === 0) return 0;
  return leaves.filter((leaf) => leaf.status === "done").length / leaves.length;
}

/**
 * Progress of one requirement: 1 or 0 for a leaf, the share of done leaves for a parent.
 *
 * Args:
 *   requirement: A leaf or parent requirement.
 *
 * Returns:
 *   A number from 0 to 1. Zero when every leaf under it is dropped.
 */
export function requirementProgress(requirement: RequirementNode): number {
  return progressOf([requirement]);
}

/**
 * Progress of an outcome across all its requirements.
 *
 * Args:
 *   roots: The outcome's root requirements, with children filled in.
 *
 * Returns:
 *   A number from 0 to 1. Zero for an outcome with no requirements.
 */
export function outcomeProgress(roots: RequirementNode[]): number {
  return progressOf(roots);
}

/**
 * The plain-language status of an outcome, as shown in the product view.
 *
 * Args:
 *   roots: The outcome's root requirements, with children filled in.
 *
 * Returns:
 *   `delivered` when every counted leaf is done; `partially_available` when a user-visible
 *   leaf is done; `in_progress` when any leaf has started; otherwise `not_started`.
 */
export function productStatus(roots: RequirementNode[]): ProductStatus {
  const leaves = countedLeaves(roots);
  const done = leaves.filter((leaf) => leaf.status === "done");

  if (leaves.length === 0) return "not_started";
  if (done.length === leaves.length) return "delivered";
  if (done.some((leaf) => leaf.userVisible)) return "partially_available";
  if (done.length > 0 || leaves.some((leaf) => leaf.status === "in_progress")) {
    return "in_progress";
  }
  return "not_started";
}
