/** Picks the Linear source for a project's roadmap import and the Linear adapter for its work items: the real API with LINEAR_API_KEY, otherwise samples. Exports linearSourceFor, linearAdapterFor, missingLinearSettings, isTeamAllowed. */
import type { SourceAdapter } from "@/adapters/source";
import { isListed } from "@/lib/allowlist";

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
 * The environment variables that are unset, of those Linear needs before real teams can be
 * connected.
 *
 * LINEAR_ALLOWED_TEAMS is required as well as the key, like GITHUB_ALLOWED_OWNERS: v1 has no
 * sign-in, so without it anyone who can open the settings page could connect any team the key's
 * owner can see.
 *
 * Returns:
 *   The names of the unset variables, empty when real teams can be connected.
 */
export function missingLinearSettings(): string[] {
  const required = {
    LINEAR_API_KEY: process.env.LINEAR_API_KEY?.trim(),
    LINEAR_ALLOWED_TEAMS: process.env.LINEAR_ALLOWED_TEAMS?.trim(),
  };
  return Object.entries(required)
    .filter(([, value]) => !value)
    .map(([name]) => name);
}

/**
 * Whether a Linear team's key is listed in LINEAR_ALLOWED_TEAMS.
 *
 * Args:
 *   teamKey: The team's key, e.g. `ENG`.
 *
 * Returns:
 *   True when the key is listed, in any case.
 */
export function isTeamAllowed(teamKey: string): boolean {
  return isListed(process.env.LINEAR_ALLOWED_TEAMS, teamKey);
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
