/** Tests for LinearApiSource against a stub fetch serving recorded-shape GraphQL responses. */
import { afterEach, describe, expect, it, vi } from "vitest";

import { LINEAR_API_URL, LinearApiSource } from "./client";
import { LinearError } from "./source";

afterEach(() => {
  vi.restoreAllMocks();
});

type Reply = { status?: number; body: unknown } | Error;

/** A fetch that answers each request with the next reply, and records the requests. */
function stubFetch(...replies: Reply[]) {
  const requests: {
    url: string;
    init: RequestInit;
    body: { variables: Record<string, unknown> };
  }[] = [];
  const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
    requests.push({ url, init, body: JSON.parse(init.body as string) });
    const reply = replies.shift();
    if (!reply) throw new Error("no reply left");
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  return { fetchFn: fetchFn as unknown as typeof fetch, requests };
}

function projectNode(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `Project ${id}`,
    description: "",
    targetDate: null,
    targetDateResolution: null,
    priority: 0,
    sortOrder: 1,
    status: { type: "planned" },
    initiatives: connection([]),
    teams: connection([{ id: "team-1", name: "Product" }]),
    ...overrides,
  };
}

function connection(nodes: unknown[], endCursor: string | null = null) {
  return { nodes, pageInfo: { hasNextPage: endCursor !== null, endCursor } };
}

function initiativeNode(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `Initiative ${id}`,
    description: "",
    status: "Active",
    targetDate: null,
    targetDateResolution: null,
    priority: 0,
    sortOrder: 1,
    ...overrides,
  };
}

function projectsPage(
  nodes: unknown[],
  endCursor: string | null,
): { body: unknown } {
  return {
    body: {
      data: {
        team: {
          id: "team-1",
          name: "Product",
          projects: {
            nodes,
            pageInfo: { hasNextPage: endCursor !== null, endCursor },
          },
        },
      },
    },
  };
}

describe("LinearApiSource.listTeams", () => {
  it("reads every page of teams and sends the key as Linear expects", async () => {
    const { fetchFn, requests } = stubFetch(
      {
        body: {
          data: {
            teams: {
              nodes: [{ id: "t1", name: "Product" }],
              pageInfo: { hasNextPage: true, endCursor: "c1" },
            },
          },
        },
      },
      {
        body: {
          data: {
            teams: {
              nodes: [{ id: "t2", name: "Platform", key: "PLT" }],
              pageInfo: { hasNextPage: false, endCursor: "c2" },
            },
          },
        },
      },
    );

    const teams = await new LinearApiSource("lin_api_x", fetchFn).listTeams();

    expect(teams).toEqual([
      { id: "t1", name: "Product" },
      { id: "t2", name: "Platform" },
    ]);
    expect(requests[0].url).toBe(LINEAR_API_URL);
    expect(requests[0].init.headers).toMatchObject({
      Authorization: "lin_api_x",
    });
    expect(requests.map((request) => request.body.variables.after)).toEqual([
      null,
      "c1",
    ]);
  });
});

describe("LinearApiSource.readTeamProjects", () => {
  it("parses projects and their initiatives across pages", async () => {
    const initiative = {
      id: "i1",
      name: "Dashboards on the go",
      description: null,
      status: "Active",
      targetDate: "2027-06-30",
      targetDateResolution: "quarter",
      priority: 2,
      sortOrder: 1.5,
    };
    const { fetchFn, requests } = stubFetch(
      projectsPage(
        [
          projectNode("p1", {
            description: "Read-only dashboards on a phone.",
            targetDate: "2027-05-14",
            priority: 2,
            status: { type: "started" },
            initiatives: connection([initiative]),
          }),
        ],
        "c1",
      ),
      projectsPage(
        [projectNode("p2", { targetDateResolution: "fortnight" })],
        null,
      ),
    );

    const { team, projects } = await new LinearApiSource(
      "key",
      fetchFn,
    ).readTeamProjects("team-1");

    expect(team).toEqual({ id: "team-1", name: "Product" });
    expect(projects).toHaveLength(2);
    expect(projects[0]).toEqual({
      id: "p1",
      name: "Project p1",
      description: "Read-only dashboards on a phone.",
      status: "started",
      targetDate: "2027-05-14",
      targetDateResolution: null,
      priority: 2,
      sortOrder: 1,
      initiatives: [{ ...initiative, description: "" }],
      teams: [{ id: "team-1", name: "Product" }],
    });
    // A resolution Linear adds later is read as a plain date.
    expect(projects[1].targetDateResolution).toBeNull();
    expect(requests.map((request) => request.body.variables)).toEqual([
      { teamId: "team-1", after: null },
      { teamId: "team-1", after: "c1" },
    ]);
  });

  it("fails without a partial list when a later page fails", async () => {
    const { fetchFn } = stubFetch(
      projectsPage([projectNode("p1")], "c1"),
      new TypeError("fetch failed"),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      new LinearApiSource("key", fetchFn).readTeamProjects("team-1"),
    ).rejects.toThrow("Linear could not be reached");
  });

  it("reads the rest of a project's initiatives and teams past the first page", async () => {
    const { fetchFn, requests } = stubFetch(
      projectsPage(
        [
          projectNode("p1", {
            initiatives: connection([initiativeNode("i1")], "ic1"),
            teams: connection([{ id: "team-1", name: "Product" }], "tc1"),
          }),
        ],
        null,
      ),
      {
        body: {
          data: {
            project: {
              initiatives: connection([initiativeNode("i2")], "ic2"),
            },
          },
        },
      },
      {
        body: {
          data: {
            project: { initiatives: connection([initiativeNode("i3")]) },
          },
        },
      },
      {
        body: {
          data: {
            project: {
              teams: connection([{ id: "team-2", name: "Platform" }]),
            },
          },
        },
      },
    );

    const { projects } = await new LinearApiSource(
      "key",
      fetchFn,
    ).readTeamProjects("team-1");

    expect(projects[0].initiatives.map((i) => i.id)).toEqual([
      "i1",
      "i2",
      "i3",
    ]);
    expect(projects[0].teams.map((t) => t.name)).toEqual([
      "Product",
      "Platform",
    ]);
    expect(requests.slice(1).map((request) => request.body.variables)).toEqual([
      { projectId: "p1", after: "ic1" },
      { projectId: "p1", after: "ic2" },
      { projectId: "p1", after: "tc1" },
    ]);
  });

  it("fails rather than drop initiatives when a later initiatives page fails", async () => {
    const { fetchFn } = stubFetch(
      projectsPage(
        [projectNode("p1", { initiatives: connection([], "ic1") })],
        null,
      ),
      { status: 502, body: null },
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      new LinearApiSource("key", fetchFn).readTeamProjects("team-1"),
    ).rejects.toThrow("could not read");
  });

  it("says when the team does not exist", async () => {
    // Query.team returns Team!, so Linear answers an unknown id with an error, not null.
    const { fetchFn } = stubFetch({
      status: 400,
      body: {
        data: null,
        errors: [
          {
            message: "Entity not found: Team - Could not find referenced Team.",
            extensions: { type: "invalid input", code: "INVALID_INPUT" },
          },
        ],
      },
    });
    await expect(
      new LinearApiSource("key", fetchFn).readTeamProjects("nope"),
    ).rejects.toThrow(/^That Linear team was not found\.$/);
  });
});

describe("LinearApiSource errors", () => {
  const source = (...replies: Reply[]) =>
    new LinearApiSource("key", stubFetch(...replies).fetchFn);

  it("explains a rejected API key", async () => {
    const error = await source({
      status: 400,
      body: {
        errors: [
          {
            message: "Authentication required, not authenticated",
            extensions: {
              type: "authentication error",
              code: "AUTHENTICATION_ERROR",
            },
          },
        ],
      },
    })
      .listTeams()
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LinearError);
    expect((error as Error).message).toContain("did not accept the API key");
  });

  it("explains an HTTP 401 with no GraphQL body", async () => {
    await expect(
      source({ status: 401, body: null }).listTeams(),
    ).rejects.toThrow("did not accept the API key");
  });

  it("explains rate limiting", async () => {
    await expect(
      source({
        status: 400,
        body: {
          errors: [
            { message: "Rate limit", extensions: { code: "RATELIMITED" } },
          ],
        },
      }).listTeams(),
    ).rejects.toThrow("limiting requests");
  });

  it("passes on other GraphQL errors", async () => {
    await expect(
      source({
        body: { errors: [{ message: "Argument Validation Error" }] },
      }).listTeams(),
    ).rejects.toThrow(
      "Linear returned an error, so nothing was imported: Argument Validation Error",
    );
  });

  it("refuses a response that does not match the schema", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      source({ body: { data: { teams: { nodes: [{ id: 1 }] } } } }).listTeams(),
    ).rejects.toThrow("could not read");
  });

  it("refuses a server error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      source({ status: 502, body: { message: "Bad gateway" } }).listTeams(),
    ).rejects.toThrow("could not read");
  });
});
