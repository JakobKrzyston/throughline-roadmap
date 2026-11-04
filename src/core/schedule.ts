/** Roadmap targets, written as a quarter ("2027-Q1") or a date ("2027-01-11"): validation, display, comparison and late work. Exports targetSchema, describeTargetMove, targetEnd, isLater, hasOpenWork, lateRequirements, scheduleWarnings, ScheduledRequirement. */
import { z } from "zod";

import { formatTarget } from "./product-text";
import type { RequirementNode } from "./rollup";

const QUARTER = /^(\d{4})-Q([1-4])$/;

/** A target as operations and agents write it: a quarter or a real calendar date. */
export const targetSchema = z.union([z.string().regex(QUARTER), z.iso.date()], {
  error: "Use a quarter like 2027-Q1 or a real date like 2027-01-11",
});

/** A requirement with the fields the schedule checks need. */
export interface ScheduledRequirement extends RequirementNode {
  key: string;
  title: string;
  target: string | null;
  children: ScheduledRequirement[];
}

/**
 * A plain-language sentence for a change of target, for the change feed.
 *
 * Args:
 *   before: The target before the change, or null when there was none.
 *   after: The target after it, or null when it was removed.
 *
 * Returns:
 *   E.g. "Moved from Q1 2027 to Q2 2027.", or null when the target did not change.
 */
export function describeTargetMove(
  before: string | null,
  after: string | null,
): string | null {
  if (before === after) return null;
  if (after === null) return "The target date was removed.";
  if (before === null) return `Now planned for ${formatTarget(after)}.`;
  return `Moved from ${formatTarget(before)} to ${formatTarget(after)}.`;
}

/**
 * The last day a target allows.
 *
 * Args:
 *   target: A valid target.
 *
 * Returns:
 *   An ISO date: the target itself for a date, the quarter's last day for a quarter.
 */
export function targetEnd(target: string): string {
  const quarter = QUARTER.exec(target);
  if (!quarter) return target;
  // Day 0 of the month after the quarter is the quarter's last day.
  const end = new Date(Date.UTC(Number(quarter[1]), Number(quarter[2]) * 3, 0));
  return end.toISOString().slice(0, 10);
}

/**
 * Whether one target ends after another. "2027-01-11" is not later than "2027-Q1".
 *
 * Args:
 *   a: A valid target.
 *   b: A valid target.
 *
 * Returns:
 *   True when a's last day is after b's.
 */
export function isLater(a: string, b: string): boolean {
  // ISO dates compare correctly as text.
  return targetEnd(a) > targetEnd(b);
}

/**
 * Whether any leaf under these requirements is still planned or in progress.
 *
 * Args:
 *   nodes: Requirements to check, e.g. an outcome's roots.
 *
 * Returns:
 *   True when some work is not yet done or dropped.
 */
export function hasOpenWork(nodes: RequirementNode[]): boolean {
  return nodes.some((node) =>
    node.children.length > 0
      ? hasOpenWork(node.children)
      : node.status === "planned" || node.status === "in_progress",
  );
}

/**
 * The unfinished requirements due after their outcome's target.
 *
 * Args:
 *   outcomeTarget: The outcome's target, or null when it has none.
 *   roots: The outcome's root requirements, with children filled in.
 *
 * Returns:
 *   Requirements at any depth with open work and a target later than the outcome's, parents
 *   before their children. Empty when the outcome has no target. Targets saved before they were
 *   validated, such as "H1 2027", cannot be compared and are treated as no target.
 */
export function lateRequirements(
  outcomeTarget: string | null,
  roots: ScheduledRequirement[],
): ScheduledRequirement[] {
  if (!isTarget(outcomeTarget)) return [];
  return roots.flatMap((node) => [
    ...(isTarget(node.target) &&
    isLater(node.target, outcomeTarget) &&
    hasOpenWork([node])
      ? [node]
      : []),
    ...lateRequirements(outcomeTarget, node.children),
  ]);
}

/**
 * The warning signs that an outcome's target looks unlikely.
 *
 * Args:
 *   target: The outcome's target, or null when it has none.
 *   roots: The outcome's root requirements, with children filled in.
 *   today: Today as an ISO date.
 *
 * Returns:
 *   The late requirements (see lateRequirements), and whether the target's last day is before
 *   today while work is still open.
 */
export function scheduleWarnings(
  target: string | null,
  roots: ScheduledRequirement[],
  today: string,
): { late: ScheduledRequirement[]; passed: boolean } {
  return {
    late: lateRequirements(target, roots),
    passed: isTarget(target) && targetEnd(target) < today && hasOpenWork(roots),
  };
}

function isTarget(target: string | null): target is string {
  return target !== null && targetSchema.safeParse(target).success;
}
