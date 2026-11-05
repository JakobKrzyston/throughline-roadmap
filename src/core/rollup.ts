/** Pure progress and product-status rollups over a requirement tree. Exports requirementProgress, rolledUpStatus, outcomeProgress, productStatus, statusCounts, teamProgress. */
import type { LeafStatus } from "./operations";

/** The parts of a requirement the rollup needs. A node with no children is a leaf. */
export interface RequirementNode {
  /** Set on leaves; null on parents. */
  status: LeafStatus | null;
  userVisible: boolean;
  children: RequirementNode[];
}

/** A requirement whose owning team is already resolved, inherited or its own. */
export interface TeamNode extends RequirementNode {
  team: string | null;
  children: TeamNode[];
}

/** One team's share of an outcome's work. */
export interface TeamProgress {
  /** Null for work no team owns. */
  team: string | null;
  done: number;
  total: number;
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
function countedLeaves<T extends RequirementNode & { children: T[] }>(
  nodes: T[],
): T[] {
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
 * The leaf status that best describes some requirements together, so a rolled-up row can be
 * coloured like a leaf in the same state.
 *
 * Args:
 *   nodes: Requirements to describe, e.g. one parent or an outcome's root requirements.
 *
 * Returns:
 *   `done` when every counted leaf is done; `in_progress` when any is done or under way;
 *   `dropped` when every leaf under them is dropped; otherwise `planned`, as for no requirements.
 */
export function rolledUpStatus(nodes: RequirementNode[]): LeafStatus {
  const leaves = countedLeaves(nodes);
  if (leaves.length === 0) return nodes.length > 0 ? "dropped" : "planned";
  if (leaves.every((leaf) => leaf.status === "done")) return "done";
  if (leaves.some((leaf) => leaf.status !== "planned")) return "in_progress";
  return "planned";
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

/**
 * How many outcomes are in each product status, for the product view's summary.
 *
 * Args:
 *   outcomes: Each outcome's root requirements, with children filled in.
 *
 * Returns:
 *   A count for every status, zero where no outcome has it.
 */
export function statusCounts(
  outcomes: RequirementNode[][],
): Record<ProductStatus, number> {
  const counts: Record<ProductStatus, number> = {
    delivered: 0,
    partially_available: 0,
    in_progress: 0,
    not_started: 0,
  };
  for (const roots of outcomes) counts[productStatus(roots)]++;
  return counts;
}

/**
 * How many counted leaves each team owns and how many of those are done, e.g. "Platform has 3
 * of 8 requirements done".
 *
 * Args:
 *   roots: An outcome's root requirements, with each node's team resolved.
 *
 * Returns:
 *   One entry per team that owns a counted leaf, sorted by name, with work no team owns last.
 *   Dropped leaves are left out, as in every other rollup.
 */
export function teamProgress(roots: TeamNode[]): TeamProgress[] {
  const byTeam = Map.groupBy(countedLeaves(roots), (leaf) => leaf.team);
  return [...byTeam]
    .map(([team, leaves]) => ({
      team,
      done: leaves.filter((leaf) => leaf.status === "done").length,
      total: leaves.length,
    }))
    .sort((a, b) =>
      a.team === null ? 1 : b.team === null ? -1 : a.team.localeCompare(b.team),
    );
}
