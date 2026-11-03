/** Zod schemas for the GitHub issue and pull request fields Throughline reads, and their mapping to SourceWorkItem. Exports githubIssueSchema, githubPullSchema, issueToWorkItem, pullToWorkItem. */
import { z } from "zod";

import type { SourceWorkItem } from "@/adapters/source";

// Webhook payloads and REST responses share these shapes, so both paths validate with the same schemas.
const common = {
  number: z.number().int(),
  title: z.string(),
  body: z.string().nullable(),
  html_url: z.url(),
  closed_at: z.iso.datetime({ offset: true }).nullable(),
};

export const githubIssueSchema = z.object({
  ...common,
  state: z.enum(["open", "closed"]),
  // Present when the "issue" is really a pull request; the issues API lists both.
  pull_request: z.object({}).optional(),
});

export const githubPullSchema = z.object({
  ...common,
  state: z.enum(["open", "closed"]),
  merged_at: z.iso.datetime({ offset: true }).nullable(),
});

type GitHubIssue = z.output<typeof githubIssueSchema>;
type GitHubPull = z.output<typeof githubPullSchema>;

/**
 * Convert a GitHub issue into a work item.
 *
 * Args:
 *   repoFullName: `owner/name` of the issue's repository.
 *   issue: The validated issue.
 *
 * Returns:
 *   The work item.
 */
export function issueToWorkItem(
  repoFullName: string,
  issue: GitHubIssue,
): SourceWorkItem {
  return {
    ...shared(repoFullName, issue),
    kind: "issue",
    state: issue.state,
    mergedAt: null,
  };
}

/**
 * Convert a GitHub pull request into a work item. A closed pull request with a merge date is `merged`.
 *
 * Args:
 *   repoFullName: `owner/name` of the pull request's repository.
 *   pull: The validated pull request.
 *
 * Returns:
 *   The work item.
 */
export function pullToWorkItem(
  repoFullName: string,
  pull: GitHubPull,
): SourceWorkItem {
  return {
    ...shared(repoFullName, pull),
    kind: "pull_request",
    state: pull.merged_at ? "merged" : pull.state,
    mergedAt: pull.merged_at ? new Date(pull.merged_at) : null,
  };
}

function shared(repoFullName: string, item: GitHubIssue | GitHubPull) {
  return {
    source: "github" as const,
    externalId: `${repoFullName}#${item.number}`,
    title: item.title,
    body: item.body ?? "",
    url: item.html_url,
    closedAt: item.closed_at ? new Date(item.closed_at) : null,
  };
}
