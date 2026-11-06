/** LinearAdapter stand-in that serves a sample Linear team's issues, for demo projects and tests; it never calls Linear. Separate from FakeLinearSource, which serves the roadmap import. Exports FakeLinearAdapter, SAMPLE_LINEAR_TEAM, sampleLinearIssues. */
import type {
  SourceAdapter,
  SourceChangedFile,
  SourceItem,
  SourceRepository,
  SourceWorkItem,
} from "@/adapters/source";

import {
  issueToWorkItem,
  type LinearIssue,
  type LinearIssueReader,
} from "./adapter";

/** The sample team demo projects can connect. */
export const SAMPLE_LINEAR_TEAM = { id: "sample-team-eng", key: "ENG" };

const DAY_MS = 86_400_000;

/**
 * The sample team's issues for the Acme Analytics demo, dated relative to `now` so the recent
 * ones always fall inside the backfill window.
 *
 * Args:
 *   now: The current time.
 *
 * Returns:
 *   One started issue, one in the backlog, and two completed ones: one in a project with no
 *   reference, and one bug fix in no project.
 */
export function sampleLinearIssues(now = new Date()): LinearIssue[] {
  const daysAgo = (days: number) =>
    new Date(now.getTime() - days * DAY_MS).toISOString();
  const issue = (
    number: number,
    fields: Partial<LinearIssue> & Pick<LinearIssue, "title" | "state">,
  ): LinearIssue => ({
    id: `sample-issue-eng-${number}`,
    description: null,
    url: `https://linear.app/acme/issue/ENG-${number}`,
    team: SAMPLE_LINEAR_TEAM,
    project: { id: "sample-project-sharing" },
    assignee: null,
    completedAt: null,
    canceledAt: null,
    updatedAt: daysAgo(1),
    ...fields,
  });
  return [
    issue(41, {
      title: "Share dialog: copy link button",
      description: "Part of TL-22",
      state: { type: "started" },
      assignee: { displayName: "leo", app: false },
    }),
    issue(42, {
      title: "Timezone picker for scheduled reports",
      description: "Implements TL-11",
      state: { type: "backlog" },
      project: { id: "sample-project-scheduling" },
    }),
    issue(43, {
      title: "Expire public links after 30 days",
      description:
        "Links shared outside the company stop working after a month.",
      state: { type: "completed" },
      assignee: { displayName: "ana", app: false },
      completedAt: daysAgo(5),
      updatedAt: daysAgo(5),
    }),
    issue(44, {
      title: "Chart tooltip cut off in Safari",
      state: { type: "completed" },
      project: null,
      completedAt: daysAgo(12),
      updatedAt: daysAgo(12),
    }),
  ];
}

/** Serves fixed Linear issues through the same interface as LinearAdapter. */
export class FakeLinearAdapter implements SourceAdapter, LinearIssueReader {
  readonly source = "linear";

  /**
   * Args:
   *   issues: The issues to serve; defaults to the sample team's.
   *   pageSize: Issues per backfill page.
   */
  constructor(
    private readonly issues: LinearIssue[] = sampleLinearIssues(),
    private readonly pageSize = 50,
  ) {}

  async findRepository(teamKey: string): Promise<SourceRepository | null> {
    const team = this.issues
      .map((issue) => issue.team)
      .concat(SAMPLE_LINEAR_TEAM)
      .find((team) => team.key.toLowerCase() === teamKey.toLowerCase());
    return team ? { externalId: team.id, fullName: team.key } : null;
  }

  async listBackfillPage(
    repository: SourceRepository,
    completedSince: Date,
    cursor: string | null,
  ): Promise<{ items: SourceItem[]; nextCursor: string | null }> {
    const matching = this.issues.filter(
      (issue) =>
        issue.team.id === repository.externalId &&
        (!["completed", "canceled", "duplicate"].includes(issue.state.type) ||
          (issue.completedAt !== null &&
            new Date(issue.completedAt) >= completedSince)),
    );
    const start = cursor ? Number(cursor) : 0;
    const end = start + this.pageSize;
    return {
      items: matching.slice(start, end).map(issueToWorkItem),
      nextCursor: end < matching.length ? String(end) : null,
    };
  }

  async listChangedFiles(): Promise<SourceChangedFile[]> {
    return [];
  }

  async readIssue(
    issueId: string,
  ): Promise<{ repository: SourceRepository; item: SourceWorkItem } | null> {
    const issue = this.issues.find((candidate) => candidate.id === issueId);
    if (!issue) return null;
    return {
      repository: { externalId: issue.team.id, fullName: issue.team.key },
      item: issueToWorkItem(issue),
    };
  }
}
