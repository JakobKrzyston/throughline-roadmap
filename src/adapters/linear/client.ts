/** LinearSource backed by Linear's GraphQL API and a workspace API key, using fetch. Responses are checked with Zod. Exports LinearApiSource, LINEAR_API_URL. */
import { z } from "zod";

import {
  LinearError,
  type LinearProject,
  type LinearSource,
  type LinearTeam,
} from "./source";

export const LINEAR_API_URL = "https://api.linear.app/graphql";

// Linear's default page size. Projects ask for at most 10 initiatives each, which keeps a page
// well inside Linear's per-query complexity limit.
const PAGE_SIZE = 50;
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
  initiatives: z
    .object({ nodes: z.array(initiative) })
    .transform((connection) => connection.nodes),
});

const teamsData = z.object({
  teams: z.object({ nodes: z.array(team), pageInfo }),
});

const teamProjectsData = z.object({
  team: team
    .extend({
      projects: z.object({ nodes: z.array(project), pageInfo }),
    })
    .nullable(),
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
        initiatives(first: 10) { nodes { ${INITIATIVE_FIELDS} } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

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
      const data: z.output<typeof teamsData> = await this.query(
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
      const data: z.output<typeof teamProjectsData> = await this.query(
        TEAM_PROJECTS_QUERY,
        { teamId, after },
        teamProjectsData,
      );
      if (!data.team) throw new LinearError("That Linear team was not found.");
      found = { id: data.team.id, name: data.team.name };
      projects.push(...data.team.projects.nodes);
      const page = data.team.projects.pageInfo;
      after = page.hasNextPage ? page.endCursor : null;
    } while (after);
    return { team: found, projects };
  }

  private async query<T>(
    query: string,
    variables: Record<string, unknown>,
    schema: z.ZodType<T>,
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchFn(LINEAR_API_URL, {
        method: "POST",
        // Personal API keys go in the header as they are; only OAuth tokens take "Bearer".
        headers: {
          "Content-Type": "application/json",
          Authorization: this.apiKey,
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      console.error("Linear request failed:", error);
      throw new LinearError(
        "Linear could not be reached, so nothing was imported. Please try again.",
      );
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
    if (errors.length > 0) {
      throw new LinearError(
        `Linear returned an error, so nothing was imported: ${errors[0].message}`,
      );
    }

    const parsed = z.object({ data: schema }).safeParse(body);
    if (!response.ok || !parsed.success) {
      console.error(
        `Unexpected Linear response (HTTP ${response.status}):`,
        parsed.error ?? body,
      );
      throw new LinearError(
        "Linear sent a response Throughline could not read, so nothing was imported. Please try again.",
      );
    }
    return parsed.data.data;
  }
}
