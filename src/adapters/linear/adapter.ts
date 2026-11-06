/** SourceAdapter that reads a Linear team's issues as work items through Linear's GraphQL API. Read-only: it never changes Linear. Exports LinearAdapter, LinearIssueReader, LinearIssue, linearIssueSchema, issueToWorkItem. */
import { z } from "zod";

import type {
  SourceAdapter,
  SourceChangedFile,
  SourceItem,
  SourceRepository,
  SourceWorkItem,
} from "@/adapters/source";

import { linearQuery } from "./client";

// Linear's default page size, the same as the roadmap import.
const PAGE_SIZE = 50;

const pageInfo = z.object({
  hasNextPage: z.boolean(),
  endCursor: z.string().nullable(),
});

const team = z.object({ id: z.string(), key: z.string() });

/** The fields of a Linear issue that Throughline reads. */
export const linearIssueSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  url: z.url(),
  // Kept as a string so a state type Linear adds later does not reject the issue.
  state: z.object({ type: z.string() }),
  team,
  project: z.object({ id: z.string() }).nullable(),
  // `app` is true for an app user, such as an agent or integration.
  assignee: z.object({ displayName: z.string(), app: z.boolean() }).nullable(),
  completedAt: z.iso.datetime({ offset: true }).nullable(),
  canceledAt: z.iso.datetime({ offset: true }).nullable(),
  updatedAt: z.iso.datetime({ offset: true }),
});

/** A Linear issue as linearIssueSchema reads it. */
export type LinearIssue = z.output<typeof linearIssueSchema>;

// The GraphQL selection matching linearIssueSchema.
const ISSUE_FIELDS = `id title description url updatedAt completedAt canceledAt
  state { type } team { id key } project { id } assignee { displayName app }`;

const teamsData = z.object({ teams: z.object({ nodes: z.array(team) }) });

const issuesData = z.object({
  issues: z.object({ nodes: z.array(linearIssueSchema), pageInfo }),
});

const TEAM_BY_KEY_QUERY = `query TeamByKey($key: String!) {
  teams(first: 1, filter: { key: { eqIgnoreCase: $key } }) { nodes { id key } }
}`;

// Open issues are those not completed, canceled or marked duplicate. Archived issues are left out.
const BACKFILL_QUERY = `query TeamIssues($teamId: ID!, $since: DateTimeOrDuration!, $after: String) {
  issues(
    first: ${PAGE_SIZE}
    after: $after
    filter: {
      team: { id: { eq: $teamId } }
      or: [
        { state: { type: { nin: ["completed", "canceled", "duplicate"] } } }
        { completedAt: { gte: $since } }
      ]
    }
  ) {
    nodes { ${ISSUE_FIELDS} }
    pageInfo { hasNextPage endCursor }
  }
}`;

const ISSUE_QUERY = `query Issue($id: ID!) {
  issues(first: 1, filter: { id: { eq: $id } }) {
    nodes { ${ISSUE_FIELDS} }
    pageInfo { hasNextPage endCursor }
  }
}`;

/** Reads one Linear issue, for webhook deliveries. */
export interface LinearIssueReader {
  /**
   * Read an issue as it is now.
   *
   * Args:
   *   issueId: The issue's Linear id.
   *
   * Returns:
   *   The issue's team and the issue as a work item, or null when it was deleted or archived.
   *
   * Raises:
   *   LinearError: Linear could not be read.
   */
  readIssue(
    issueId: string,
  ): Promise<{ repository: SourceRepository; item: SourceWorkItem } | null>;
}

/** Reads a Linear team's issues with a workspace API key. A connected team is stored as a repository. */
export class LinearAdapter implements SourceAdapter, LinearIssueReader {
  readonly source = "linear";

  /**
   * Args:
   *   apiKey: A Linear API key (see docs/LINEAR.md).
   *   fetchFn: The fetch to send requests with; tests pass a stub.
   */
  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async findRepository(teamKey: string): Promise<SourceRepository | null> {
    const data = await linearQuery(
      this.apiKey,
      this.fetchFn,
      TEAM_BY_KEY_QUERY,
      { key: teamKey },
      teamsData,
    );
    const [found] = data.teams.nodes;
    return found ? { externalId: found.id, fullName: found.key } : null;
  }

  async listBackfillPage(
    repository: SourceRepository,
    completedSince: Date,
    cursor: string | null,
  ): Promise<{ items: SourceItem[]; nextCursor: string | null }> {
    const data = await linearQuery(
      this.apiKey,
      this.fetchFn,
      BACKFILL_QUERY,
      {
        teamId: repository.externalId,
        since: completedSince.toISOString(),
        after: cursor,
      },
      issuesData,
    );
    const page = data.issues.pageInfo;
    return {
      items: data.issues.nodes.map(issueToWorkItem),
      nextCursor: page.hasNextPage ? page.endCursor : null,
    };
  }

  // A Linear issue has no code changes of its own; the agents read its title and description.
  async listChangedFiles(): Promise<SourceChangedFile[]> {
    return [];
  }

  async readIssue(
    issueId: string,
  ): Promise<{ repository: SourceRepository; item: SourceWorkItem } | null> {
    const data = await linearQuery(
      this.apiKey,
      this.fetchFn,
      ISSUE_QUERY,
      { id: issueId },
      issuesData,
    );
    const [issue] = data.issues.nodes;
    if (!issue) return null;
    return {
      repository: { externalId: issue.team.id, fullName: issue.team.key },
      item: issueToWorkItem(issue),
    };
  }
}

/**
 * Convert a Linear issue into a work item.
 *
 * Linear's state types map to states: `completed` is closed as done, `canceled` and `duplicate`
 * are not planned, and anything else is open, with `started` set for a started issue (such as
 * In Progress).
 *
 * Args:
 *   issue: The validated issue.
 *
 * Returns:
 *   The work item.
 */
export function issueToWorkItem(issue: LinearIssue): SourceWorkItem {
  const type = issue.state.type;
  const state =
    type === "completed"
      ? "closed"
      : type === "canceled" || type === "duplicate"
        ? "not_planned"
        : "open";
  return {
    source: "linear",
    externalId: issue.id,
    kind: "issue",
    title: issue.title,
    body: issue.description ?? "",
    url: issue.url,
    state,
    // App users, such as agents, are left out: nobody can ask them about the work.
    people:
      issue.assignee && !issue.assignee.app ? [issue.assignee.displayName] : [],
    mergedAt: null,
    closedAt:
      state === "open"
        ? null
        : new Date(issue.completedAt ?? issue.canceledAt ?? issue.updatedAt),
    updatedAt: new Date(issue.updatedAt),
    started: type === "started",
    inProject: issue.project !== null,
    teamKey: issue.team.key,
  };
}
