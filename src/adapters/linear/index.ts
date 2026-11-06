/** Picks the Linear source for a project's roadmap import and the Linear adapter for its work items: the real API with LINEAR_API_KEY, otherwise samples. Exports linearSourceFor, linearAdapterFor, isLinearConfigured. */
import type { SourceAdapter } from "@/adapters/source";

import { LinearAdapter, type LinearIssueReader } from "./adapter";
import { LinearApiSource } from "./client";
import { FakeLinearSource } from "./fake";
import { FakeLinearAdapter } from "./fake-adapter";
import type { LinearSource } from "./source";

/**
 * Return the Linear source to import a project's roadmap from.
 *
 * Demo projects always read the sample workspace, so visitors never read the owner's Linear.
 *
 * Args:
 *   project: The project's demo flag.
 *
 * Returns:
 *   The source, and `sample: true` when it is the sample workspace (a demo project, or
 *   LINEAR_API_KEY unset or blank).
 */
export function linearSourceFor(project: { isDemo: boolean }): {
  source: LinearSource;
  sample: boolean;
} {
  const apiKey = process.env.LINEAR_API_KEY?.trim();
  if (project.isDemo || !apiKey) {
    return { source: new FakeLinearSource(), sample: true };
  }
  return { source: new LinearApiSource(apiKey), sample: false };
}

/**
 * Whether LINEAR_API_KEY is set, so real Linear teams can be connected.
 *
 * Returns:
 *   True when the key is set and not blank.
 */
export function isLinearConfigured(): boolean {
  return Boolean(process.env.LINEAR_API_KEY?.trim());
}

/**
 * Return the adapter that reads a project's connected Linear team's issues.
 *
 * Demo projects always get the sample team, so they never call Linear.
 *
 * Args:
 *   project: The project's demo flag.
 *
 * Returns:
 *   The adapter, or null for a real project when LINEAR_API_KEY is unset or blank.
 */
export function linearAdapterFor(project: {
  isDemo: boolean;
}): (SourceAdapter & LinearIssueReader) | null {
  if (project.isDemo) return new FakeLinearAdapter();
  const apiKey = process.env.LINEAR_API_KEY?.trim();
  return apiKey ? new LinearAdapter(apiKey) : null;
}
