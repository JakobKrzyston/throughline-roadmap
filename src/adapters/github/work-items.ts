/** Zod schemas for the GitHub issue and pull request fields Throughline reads, and their mapping to SourceWorkItem. Exports githubIssueSchema, githubPullSchema, githubPullFileSchema, issueToWorkItem, pullToWorkItem, pullFileToChangedFile. */
import { z } from "zod";

import type { SourceChangedFile, SourceWorkItem } from "@/adapters/source";

// Webhook payloads and REST responses share these shapes, so both paths validate with the same schemas.
const common = {
  number: z.number().int(),
  title: z.string(),
  body: z.string().nullable(),
  html_url: z.url(),
  closed_at: z.iso.datetime({ offset: true }).nullable(),
  updated_at: z.iso.datetime({ offset: true }),
};

export const githubIssueSchema = z.object({
  ...common,
  state: z.enum(["open", "closed"]),
  // Why a closed issue was closed. Kept as a string so a new reason GitHub adds does not reject the payload.
  state_reason: z.string().nullish(),
  // Present when the "issue" is really a pull request; the issues API lists both.
  pull_request: z.object({}).optional(),
});

export const githubPullSchema = z.object({
  ...common,
  state: z.enum(["open", "closed"]),
  merged_at: z.iso.datetime({ offset: true }).nullable(),
});

export const githubPullFileSchema = z.object({
  filename: z.string(),
  // Kept as a string so a status GitHub adds later does not reject the response.
  status: z.string(),
  additions: z.number().int(),
  deletions: z.number().int(),
  // GitHub leaves the patch out for binary and very large files.
  patch: z.string().optional(),
});

type GitHubIssue = z.output<typeof githubIssueSchema>;
type GitHubPull = z.output<typeof githubPullSchema>;

/**
 * Convert a GitHub issue into a work item.
 *
 * Args:
 *   repositoryId: GitHub's numeric id of the issue's repository, which survives renames.
 *   issue: The validated issue.
 *
 * Returns:
 *   The work item.
 */
export function issueToWorkItem(
  repositoryId: string,
  issue: GitHubIssue,
): SourceWorkItem {
  return {
    ...shared(repositoryId, issue),
    kind: "issue",
    // Issues closed before GitHub recorded reasons have none; count those as done.
    state:
      issue.state === "closed" &&
      (issue.state_reason === "not_planned" ||
        issue.state_reason === "duplicate")
        ? "not_planned"
        : issue.state,
    mergedAt: null,
  };
}

/**
 * Convert a GitHub pull request into a work item. A closed pull request with a merge date is `merged`.
 *
 * Args:
 *   repositoryId: GitHub's numeric id of the pull request's repository, which survives renames.
 *   pull: The validated pull request.
 *
 * Returns:
 *   The work item.
 */
export function pullToWorkItem(
  repositoryId: string,
  pull: GitHubPull,
): SourceWorkItem {
  return {
    ...shared(repositoryId, pull),
    kind: "pull_request",
    state: pull.merged_at ? "merged" : pull.state,
    mergedAt: pull.merged_at ? new Date(pull.merged_at) : null,
  };
}

/**
 * Convert one file from a pull request's file list into a changed file.
 *
 * Args:
 *   file: The validated file entry.
 *
 * Returns:
 *   The changed file. GitHub's `copied` counts as added; `changed` and `unchanged` (a mode or
 *   rename-only change) count as modified.
 */
export function pullFileToChangedFile(
  file: z.output<typeof githubPullFileSchema>,
): SourceChangedFile {
  const status =
    file.status === "added" || file.status === "copied"
      ? "added"
      : file.status === "removed" || file.status === "renamed"
        ? file.status
        : "modified";
  return {
    path: file.filename,
    status,
    additions: file.additions,
    deletions: file.deletions,
    patch: file.patch ?? null,
  };
}

function shared(repositoryId: string, item: GitHubIssue | GitHubPull) {
  return {
    source: "github" as const,
    externalId: `${repositoryId}#${item.number}`,
    title: item.title,
    body: item.body ?? "",
    url: item.html_url,
    closedAt: item.closed_at ? new Date(item.closed_at) : null,
    updatedAt: new Date(item.updated_at),
  };
}
