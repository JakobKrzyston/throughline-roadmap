/** Test fixtures: minimal GitHub webhook payloads. Exports pullRequestPayload, issuePayload, REPO. */

export const REPO = { id: 4242, full_name: "acme/analytics" };

/**
 * A `pull_request` delivery with only the fields Throughline reads.
 *
 * Args:
 *   overrides: Fields to change on the pull request.
 *   action: The delivery's action.
 *
 * Returns:
 *   The payload.
 */
export function pullRequestPayload(
  overrides: Record<string, unknown> = {},
  action = "opened",
): Record<string, unknown> {
  return {
    action,
    repository: REPO,
    pull_request: {
      number: 41,
      title: "Add CSV export",
      body: "Implements TL-3",
      html_url: "https://github.com/acme/analytics/pull/41",
      state: "open",
      merged_at: null,
      closed_at: null,
      updated_at: "2026-11-01T09:00:00Z",
      ...overrides,
    },
  };
}

/**
 * An `issues` delivery with only the fields Throughline reads.
 *
 * Args:
 *   overrides: Fields to change on the issue.
 *   action: The delivery's action.
 *
 * Returns:
 *   The payload.
 */
export function issuePayload(
  overrides: Record<string, unknown> = {},
  action = "opened",
): Record<string, unknown> {
  return {
    action,
    repository: REPO,
    issue: {
      number: 7,
      title: "Excel export is slow",
      body: null,
      html_url: "https://github.com/acme/analytics/issues/7",
      state: "open",
      closed_at: null,
      updated_at: "2026-11-01T09:00:00Z",
      ...overrides,
    },
  };
}
