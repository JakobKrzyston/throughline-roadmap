/** LinearSource backed by Linear's GraphQL API and a workspace API key, using fetch, and the request function it shares with LinearAdapter. Responses are checked with Zod. Exports LinearApiSource, linearQuery, LINEAR_API_URL. */
import { z } from "zod";

import {
  LinearError,
  type LinearProject,
  type LinearSource,
  type LinearTeam,
} from "./source";

export const LINEAR_API_URL = "https://api.linear.app/graphql";

// Linear's default page size. Each project asks for its first 10 initiatives and teams, which
// keeps a page well inside Linear's per-query complexity limit; the rest are read separately.
const PAGE_SIZE = 50;
const NESTED_PAGE_SIZE = 10;
const TIMEOUT_MS = 20_000;

const pageInfo = z.object({
  hasNextPage: z.boolean(),
  endCursor: z.string().nullable(),
});

const team = z.object({ id: z.string(), name: z.string() });

// An unknown resolution (one Linear adds later) is read as a plain date rather than failing.
const resolution = z
  .enum(["month", "quarter", "halfYear", "year"])
  .nullable()
  .catch(null);

const initiative = z.object({
  id: z.string(),
  name: z.string(),
  description: z
    .string()
    .nullable()
    .transform((value) => value ?? ""),
  status: z.string(),
  targetDate: z.iso.date().nullable(),
  targetDateResolution: resolution,
  priority: z.number().int(),
  sortOrder: z.number(),
});

const project = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  status: z.object({ type: z.string() }).transform((status) => status.type),
  targetDate: z.iso.date().nullable(),
  targetDateResolution: resolution,
  priority: z.number().int(),
  sortOrder: z.number(),
  initiatives: z.object({ nodes: z.array(initiative), pageInfo }),
  teams: z.object({ nodes: z.array(team), pageInfo }),
});

const teamsData = z.object({
  teams: z.object({ nodes: z.array(team), pageInfo }),
});

// Query.team returns Team!: an unknown id is a GraphQL "Entity not found" error, not null.
const teamProjectsData = z.object({
  team: team.extend({
    projects: z.object({ nodes: z.array(project), pageInfo }),
  }),
});

const projectInitiativesData = z.object({
  project: z.object({
    initiatives: z.object({ nodes: z.array(initiative), pageInfo }),
  }),
});

const projectTeamsData = z.object({
  project: z.object({ teams: z.object({ nodes: z.array(team), pageInfo }) }),
});

const graphqlErrors = z.object({
  errors: z
    .array(
      z.object({
        message: z.string(),
        extensions: z
          .object({ code: z.string().optional(), type: z.string().optional() })
          .optional(),
      }),
    )
    .optional(),
});

const TEAMS_QUERY = `query Teams($after: String) {
  teams(first: ${PAGE_SIZE}, after: $after) {
    nodes { id name }
    pageInfo { hasNextPage endCursor }
  }
}`;

const INITIATIVE_FIELDS =
  "id name description status targetDate targetDateResolution priority sortOrder";

const TEAM_PROJECTS_QUERY = `query TeamProjects($teamId: String!, $after: String) {
  team(id: $teamId) {
    id name
    projects(first: ${PAGE_SIZE}, after: $after) {
      nodes {
        id name description targetDate targetDateResolution priority sortOrder
        status { type }
        initiatives(first: ${NESTED_PAGE_SIZE}) {
          nodes { ${INITIATIVE_FIELDS} }
          pageInfo { hasNextPage endCursor }
        }
        teams(first: ${NESTED_PAGE_SIZE}) {
          nodes { id name }
          pageInfo { hasNextPage endCursor }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

const PROJECT_INITIATIVES_QUERY = `query ProjectInitiatives($projectId: String!, $after: String) {
  project(id: $projectId) {
    initiatives(first: ${PAGE_SIZE}, after: $after) {
      nodes { ${INITIATIVE_FIELDS} }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

const PROJECT_TEAMS_QUERY = `query ProjectTeams($projectId: String!, $after: String) {
  project(id: $projectId) {
    teams(first: ${PAGE_SIZE}, after: $after) {
      nodes { id name }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

const TEAM_NOT_FOUND = "That Linear team was not found.";
const CHANGED_WHILE_READING =
  "A Linear project changed while it was being read, so nothing was imported. Please try again.";

/** Reads teams and projects from Linear with a workspace API key. */
export class LinearApiSource implements LinearSource {
  /**
   * Args:
   *   apiKey: A Linear API key (Settings → Security & access → Personal API keys).
   *   fetchFn: The fetch to send requests with; tests pass a stub.
   */
  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async listTeams(): Promise<LinearTeam[]> {
    const teams: LinearTeam[] = [];
    let after: string | null = null;
    do {
      const data: z.output<typeof teamsData> = await linearQuery(
        this.apiKey,
        this.fetchFn,
        TEAMS_QUERY,
        { after },
        teamsData,
      );
      teams.push(...data.teams.nodes);
      after = data.teams.pageInfo.hasNextPage
        ? data.teams.pageInfo.endCursor
        : null;
    } while (after);
    return teams;
  }

  async readTeamProjects(
    teamId: string,
  ): Promise<{ team: LinearTeam; projects: LinearProject[] }> {
    const projects: LinearProject[] = [];
    let found: LinearTeam | null = null;
    let after: string | null = null;
    do {
      const data: z.output<typeof teamProjectsData> = await linearQuery(
        this.apiKey,
        this.fetchFn,
        TEAM_PROJECTS_QUERY,
        { teamId, after },
        teamProjectsData,
        TEAM_NOT_FOUND,
      );
      found = { id: data.team.id, name: data.team.name };
      for (const node of data.team.projects.nodes) {
        projects.push({
          ...node,
          initiatives: [
            ...node.initiatives.nodes,
            ...(await this.restOfInitiatives(
              node.id,
              node.initiatives.pageInfo,
            )),
          ],
          teams: [
            ...node.teams.nodes,
            ...(await this.restOfTeams(node.id, node.teams.pageInfo)),
          ],
        });
      }
      const page = data.team.projects.pageInfo;
      after = page.hasNextPage ? page.endCursor : null;
    } while (after);
    return { team: found!, projects };
  }

  // The initiatives after a project's first page, for the rare project in more than ten.
  private async restOfInitiatives(
    projectId: string,
    first: z.output<typeof pageInfo>,
  ): Promise<z.output<typeof initiative>[]> {
    const rest: z.output<typeof initiative>[] = [];
    let after = first.hasNextPage ? first.endCursor : null;
    while (after) {
      const data: z.output<typeof projectInitiativesData> = await linearQuery(
        this.apiKey,
        this.fetchFn,
        PROJECT_INITIATIVES_QUERY,
        { projectId, after },
        projectInitiativesData,
        CHANGED_WHILE_READING,
      );
      rest.push(...data.project.initiatives.nodes);
      const page = data.project.initiatives.pageInfo;
      after = page.hasNextPage ? page.endCursor : null;
    }
    return rest;
  }

  // The teams after a project's first page, for a project shared with more than ten.
  private async restOfTeams(
    projectId: string,
    first: z.output<typeof pageInfo>,
  ): Promise<LinearTeam[]> {
    const rest: LinearTeam[] = [];
    let after = first.hasNextPage ? first.endCursor : null;
    while (after) {
      const data: z.output<typeof projectTeamsData> = await linearQuery(
        this.apiKey,
        this.fetchFn,
        PROJECT_TEAMS_QUERY,
        { projectId, after },
        projectTeamsData,
        CHANGED_WHILE_READING,
      );
      rest.push(...data.project.teams.nodes);
      const page = data.project.teams.pageInfo;
      after = page.hasNextPage ? page.endCursor : null;
    }
    return rest;
  }
}

/**
 * Send one GraphQL query to Linear and check the response's data with a schema.
 *
 * Args:
 *   apiKey: A Linear API key.
 *   fetchFn: The fetch to send the request with; tests pass a stub.
 *   query: The GraphQL query.
 *   variables: The query's variables.
 *   schema: The shape the response's `data` must have.
 *   notFoundMessage: The error to raise when Linear says an id in the query does not exist;
 *     without it, that is reported like any other GraphQL error.
 *
 * Returns:
 *   The parsed `data`.
 *
 * Raises:
 *   LinearError: Linear could not be reached, rejected the key, limited the request, returned
 *     an error, or sent a response that does not match the schema.
 */
export async function linearQuery<T>(
  apiKey: string,
  fetchFn: typeof fetch,
  query: string,
  variables: Record<string, unknown>,
  schema: z.ZodType<T>,
  notFoundMessage?: string,
): Promise<T> {
  let response: Response;
  try {
    response = await fetchFn(LINEAR_API_URL, {
      method: "POST",
      // Personal API keys go in the header as they are; only OAuth tokens take "Bearer".
      headers: {
        "Content-Type": "application/json",
        Authorization: apiKey,
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    console.error("Linear request failed:", error);
    throw new LinearError("Linear could not be reached. Please try again.");
  }

  const body: unknown = await response.json().catch(() => null);
  const errors = graphqlErrors.safeParse(body).data?.errors ?? [];
  const isAuthError = errors.some(
    (error) =>
      error.extensions?.code === "AUTHENTICATION_ERROR" ||
      error.extensions?.type === "authentication error",
  );
  if (response.status === 401 || response.status === 403 || isAuthError) {
    throw new LinearError(
      "Linear did not accept the API key. Check LINEAR_API_KEY (see docs/LINEAR.md).",
    );
  }
  if (
    response.status === 429 ||
    errors.some((error) => error.extensions?.code === "RATELIMITED")
  ) {
    throw new LinearError(
      "Linear is limiting requests right now. Wait a minute and try again.",
    );
  }
  // Linear answers a lookup by an unknown or deleted id with "Entity not found: Team - …".
  if (
    notFoundMessage &&
    errors.some((error) => /^entity not found/i.test(error.message))
  ) {
    throw new LinearError(notFoundMessage);
  }
  if (errors.length > 0) {
    throw new LinearError(`Linear returned an error: ${errors[0].message}`);
  }

  const parsed = z.object({ data: schema }).safeParse(body);
  if (!response.ok || !parsed.success) {
    console.error(
      `Unexpected Linear response (HTTP ${response.status}):`,
      parsed.error ?? body,
    );
    throw new LinearError(
      "Linear sent a response Throughline could not read. Please try again.",
    );
  }
  return parsed.data.data;
}
