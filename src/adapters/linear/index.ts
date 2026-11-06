/** Picks the Linear source for a project: the real API with LINEAR_API_KEY, otherwise the sample workspace. Exports linearSourceFor. */
import { LinearApiSource } from "./client";
import { FakeLinearSource } from "./fake";
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
