/** Filters the technical view's requirement tree by kind of work, team and person. Exports BreakdownFilter, BreakdownNode, visibleKeys, filterOptions. */
import type { WorkType } from "./operations";

/** What the reader filters by. A field left out does not filter. */
export interface BreakdownFilter {
  workType?: WorkType;
  /** Matched against each requirement's team, inherited or its own. */
  team?: string;
  /** A login on the requirement's linked work items. */
  person?: string;
}

/** The parts of a requirement the filter reads, as loadRoadmap returns them. */
export interface BreakdownNode {
  key: string;
  workType: WorkType | null;
  team: string | null;
  people: string[];
  children: BreakdownNode[];
}

/**
 * The keys of the requirements to show for a filter.
 *
 * A requirement shows when it matches every filter that is set, or when one of its descendants
 * does, so a match is always shown with the requirements it was split from.
 *
 * Args:
 *   roots: An outcome's root requirements.
 *   filter: What to filter by.
 *
 * Returns:
 *   The keys of every requirement to show, at any depth. Empty when nothing matches.
 */
export function visibleKeys(
  roots: BreakdownNode[],
  filter: BreakdownFilter,
): Set<string> {
  const keys = new Set<string>();
  const matches = (node: BreakdownNode): boolean =>
    (filter.workType === undefined || node.workType === filter.workType) &&
    (filter.team === undefined || node.team === filter.team) &&
    (filter.person === undefined || node.people.includes(filter.person));
  // Every child is visited, so all matches below a node are collected, not just the first.
  const visit = (node: BreakdownNode): boolean => {
    const below = node.children.map(visit).some(Boolean);
    const shown = below || matches(node);
    if (shown) keys.add(node.key);
    return shown;
  };
  roots.forEach(visit);
  return keys;
}

/**
 * The teams and people that appear in a roadmap, for the filter's choices.
 *
 * Args:
 *   roadmap: Outcomes with their requirement trees.
 *
 * Returns:
 *   Distinct teams and people, each sorted.
 */
export function filterOptions(roadmap: { requirements: BreakdownNode[] }[]): {
  teams: string[];
  people: string[];
} {
  const teams = new Set<string>();
  const people = new Set<string>();
  const visit = (node: BreakdownNode): void => {
    if (node.team) teams.add(node.team);
    node.people.forEach((person) => people.add(person));
    node.children.forEach(visit);
  };
  roadmap.forEach((outcome) => outcome.requirements.forEach(visit));
  // The same order as the rollup by team, which uses localeCompare too.
  const sorted = (values: Set<string>): string[] =>
    [...values].sort((a, b) => a.localeCompare(b));
  return { teams: sorted(teams), people: sorted(people) };
}
