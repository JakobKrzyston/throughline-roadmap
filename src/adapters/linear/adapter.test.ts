/** Tests for LinearAdapter's issue mapping and its GraphQL requests, against a stub fetch. */
import { describe, expect, it, vi } from "vitest";

import { type LinearIssue, LinearAdapter, issueToWorkItem } from "./adapter";
import { FakeLinearAdapter, sampleLinearIssues } from "./fake-adapter";
import { LinearError } from "./source";

function issue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    identifier: "ENG-12",
    title: "CSV export button",
    description: "Implements TL-3",
    url: "https://linear.app/acme/issue/ENG-12/csv-export-button",
    state: { type: "unstarted" },
    team: { id: "team-1", key: "ENG" },
    project: { id: "project-1" },
    assignee: { displayName: "maya", app: false },
    completedAt: null,
    canceledAt: null,
    updatedAt: "2026-11-01T09:00:00.123Z",
    ...overrides,
  };
}

/** A fetch that answers each request with the next body, and records the requests' variables. */
function stubFetch(...bodies: unknown[]) {
  const variables: Record<string, unknown>[] = [];
  const queries: string[] = [];
  const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    variables.push(body.variables);
    queries.push(body.query);
    return Response.json(bodies.shift());
  });
  return { fetchFn: fetchFn as unknown as typeof fetch, variables, queries };
}

const issuesReply = (nodes: unknown[], endCursor: string | null = null) => ({
  data: {
    issues: { nodes, pageInfo: { hasNextPage: endCursor !== null, endCursor } },
  },
});

describe("issueToWorkItem", () => {
  it("maps an issue's fields, using its Linear id as the external id", () => {
    expect(issueToWorkItem(issue())).toEqual({
      source: "linear",
      externalId: "issue-1",
      kind: "issue",
      title: "CSV export button",
      body: "Implements TL-3",
      url: "https://linear.app/acme/issue/ENG-12/csv-export-button",
      state: "open",
      people: ["maya"],
      mergedAt: null,
      closedAt: null,
      updatedAt: new Date("2026-11-01T09:00:00.123Z"),
      started: false,
      inProject: true,
      identifier: "ENG-12",
    });
  });

  it.each([
    ["triage", "open", false],
    ["backlog", "open", false],
    ["unstarted", "open", false],
    ["started", "open", true],
    ["completed", "closed", false],
    ["canceled", "not_planned", false],
    ["duplicate", "not_planned", false],
    ["some_new_type", "open", false],
  ])("maps state type %s to %s", (type, state, started) => {
    expect(issueToWorkItem(issue({ state: { type } }))).toMatchObject({
      state,
      started,
    });
  });

  it("dates a finished issue by when it was completed or canceled", () => {
    expect(
      issueToWorkItem(
        issue({
          state: { type: "completed" },
          completedAt: "2026-11-02T10:00:00.000Z",
        }),
      ).closedAt,
    ).toEqual(new Date("2026-11-02T10:00:00.000Z"));
    expect(
      issueToWorkItem(
        issue({
          state: { type: "canceled" },
          canceledAt: "2026-11-03T10:00:00.000Z",
        }),
      ).closedAt,
    ).toEqual(new Date("2026-11-03T10:00:00.000Z"));
  });

  it("leaves out an app user assigned to the issue, and an unassigned issue has no people", () => {
    expect(
      issueToWorkItem(issue({ assignee: { displayName: "agent", app: true } }))
        .people,
    ).toEqual([]);
    expect(issueToWorkItem(issue({ assignee: null })).people).toEqual([]);
  });

  it("marks an issue outside any project, and reads a missing description as empty", () => {
    expect(
      issueToWorkItem(issue({ project: null, description: null })),
    ).toMatchObject({ inProject: false, body: "" });
  });
});

describe("LinearAdapter", () => {
  it("finds a team by key, in any case", async () => {
    const { fetchFn, variables } = stubFetch({
      data: { teams: { nodes: [{ id: "team-1", key: "ENG" }] } },
    });
    expect(
      await new LinearAdapter("key", fetchFn).findRepository("eng"),
    ).toEqual({ externalId: "team-1", fullName: "ENG" });
    expect(variables).toEqual([{ key: "eng" }]);
  });

  it("returns null for an unknown team key", async () => {
    const { fetchFn } = stubFetch({ data: { teams: { nodes: [] } } });
    expect(
      await new LinearAdapter("key", fetchFn).findRepository("NOPE"),
    ).toBeNull();
  });

  it("reads a backfill page of the team's issues and returns the next cursor", async () => {
    const { fetchFn, variables, queries } = stubFetch(
      issuesReply([issue()], "cursor-1"),
      issuesReply([issue({ id: "issue-2" })]),
    );
    const adapter = new LinearAdapter("key", fetchFn);
    const team = { externalId: "team-1", fullName: "ENG" };
    const since = new Date("2026-08-08T00:00:00.000Z");

    const first = await adapter.listBackfillPage(team, since, null);
    expect(first.items.map((item) => item.externalId)).toEqual(["issue-1"]);
    expect(first.nextCursor).toBe("cursor-1");
    const second = await adapter.listBackfillPage(team, since, "cursor-1");
    expect(second.nextCursor).toBeNull();

    expect(variables).toEqual([
      { teamId: "team-1", since: "2026-08-08T00:00:00.000Z", after: null },
      {
        teamId: "team-1",
        since: "2026-08-08T00:00:00.000Z",
        after: "cursor-1",
      },
    ]);
    // Open issues, or issues completed since the cut-off.
    expect(queries[0]).toContain(
      '{ state: { type: { nin: ["completed", "canceled", "duplicate"] } } }',
    );
    expect(queries[0]).toContain("{ completedAt: { gte: $since } }");
  });

  it("reads one issue with its team, and null for an issue Linear no longer returns", async () => {
    const { fetchFn } = stubFetch(issuesReply([issue()]), issuesReply([]));
    const adapter = new LinearAdapter("key", fetchFn);
    expect(await adapter.readIssue("issue-1")).toMatchObject({
      repository: { externalId: "team-1", fullName: "ENG" },
      item: { externalId: "issue-1", identifier: "ENG-12" },
    });
    expect(await adapter.readIssue("gone")).toBeNull();
  });

  it("reports an issue Linear sends in an unexpected shape as a LinearError", async () => {
    const { fetchFn } = stubFetch(issuesReply([{ id: "issue-1" }]));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      new LinearAdapter("key", fetchFn).readIssue("issue-1"),
    ).rejects.toBeInstanceOf(LinearError);
  });

  it("has no changed files for an issue", async () => {
    const { fetchFn } = stubFetch();
    expect(await new LinearAdapter("key", fetchFn).listChangedFiles()).toEqual(
      [],
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("FakeLinearAdapter", () => {
  const team = { externalId: "sample-team-eng", fullName: "ENG" };
  const now = new Date("2026-11-06T12:00:00.000Z");

  it("serves open issues and issues completed since the cut-off, a page at a time", async () => {
    const old = issue({
      id: "old",
      team: { id: "sample-team-eng", key: "ENG" },
      state: { type: "completed" },
      completedAt: "2026-01-01T00:00:00.000Z",
    });
    const adapter = new FakeLinearAdapter([...sampleLinearIssues(now), old], 3);
    const since = new Date(now.getTime() - 90 * 86_400_000);

    const first = await adapter.listBackfillPage(team, since, null);
    const second = await adapter.listBackfillPage(
      team,
      since,
      first.nextCursor,
    );
    expect(first.items).toHaveLength(3);
    expect(second).toMatchObject({ nextCursor: null });
    expect(
      [...first.items, ...second.items].map((item) => item.externalId),
    ).not.toContain("old");
    expect(first.items.length + second.items.length).toBe(4);
  });

  it("finds the sample team by key", async () => {
    expect(await new FakeLinearAdapter().findRepository("eng")).toEqual(team);
    expect(await new FakeLinearAdapter().findRepository("OPS")).toBeNull();
  });
});
