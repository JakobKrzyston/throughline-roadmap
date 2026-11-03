/** Tests for GitHubAdapter against a fake Octokit app. */
import { RequestError } from "octokit";
import { describe, expect, it } from "vitest";

import { GitHubAdapter, type GitHubApp } from "./adapter";

const notFound = (): RequestError =>
  new RequestError("Not Found", 404, {
    request: { method: "GET", url: "https://api.github.com/x", headers: {} },
  });

function pull(number: number, mergedAt: string | null, updatedAt: string) {
  return {
    number,
    title: `PR ${number}`,
    body: null,
    html_url: `https://github.com/acme/analytics/pull/${number}`,
    state: "closed",
    merged_at: mergedAt,
    closed_at: updatedAt,
    updated_at: updatedAt,
  };
}

/** A fake GitHub App installed on acme/analytics only. Records how many PR pages were read. */
function fakeApp(options: {
  issues?: unknown[];
  pullPages?: ReturnType<typeof pull>[][];
}) {
  const read = { pullPages: 0 };
  const listForRepo = () => {};
  const octokit = {
    rest: {
      repos: {
        get: async () => ({
          data: { id: 4242, full_name: "acme/analytics" },
        }),
      },
      issues: { listForRepo },
      pulls: { list: () => {} },
    },
    paginate: Object.assign(
      async (endpoint: unknown) => {
        expect(endpoint).toBe(listForRepo);
        return options.issues ?? [];
      },
      {
        iterator: async function* () {
          for (const data of options.pullPages ?? []) {
            read.pullPages++;
            yield { data };
          }
        },
      },
    ),
  };
  const app = {
    octokit: {
      rest: {
        apps: {
          getRepoInstallation: async ({
            owner,
            repo,
          }: {
            owner: string;
            repo: string;
          }) => {
            if (`${owner}/${repo}` !== "acme/analytics") throw notFound();
            return { data: { id: 1 } };
          },
        },
      },
    },
    getInstallationOctokit: async () => octokit,
  };
  return { app: app as unknown as GitHubApp, read };
}

describe("GitHubAdapter.findRepository", () => {
  it("returns the repository's stable id and canonical name", async () => {
    const { app } = fakeApp({});
    expect(
      await new GitHubAdapter(app).findRepository("acme/analytics"),
    ).toEqual({ externalId: "4242", fullName: "acme/analytics" });
  });

  it("returns null when the app is not installed on the repository", async () => {
    const { app } = fakeApp({});
    expect(
      await new GitHubAdapter(app).findRepository("acme/private"),
    ).toBeNull();
  });
});

describe("GitHubAdapter.listBackfill", () => {
  const since = new Date("2026-08-01T00:00:00Z");

  it("returns open issues but not the pull requests the issues API mixes in", async () => {
    const issue = {
      number: 7,
      title: "Slow export",
      body: "Part of TL-4",
      html_url: "https://github.com/acme/analytics/issues/7",
      state: "open",
      closed_at: null,
    };
    const { app } = fakeApp({
      issues: [issue, { ...issue, number: 8, pull_request: {} }],
    });
    const items = await new GitHubAdapter(app).listBackfill(
      "acme/analytics",
      since,
    );
    expect(items.map((item) => item.externalId)).toEqual(["acme/analytics#7"]);
    expect(items[0]).toMatchObject({ kind: "issue", body: "Part of TL-4" });
  });

  it("returns pull requests merged since the cutoff and stops paging at older updates", async () => {
    const { app, read } = fakeApp({
      pullPages: [
        [
          pull(30, "2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z"),
          pull(29, null, "2026-09-01T00:00:00Z"), // closed without merging
          pull(28, "2026-07-01T00:00:00Z", "2026-07-15T00:00:00Z"), // merged before the cutoff
        ],
        [pull(27, "2026-06-01T00:00:00Z", "2026-06-01T00:00:00Z")],
      ],
    });
    const items = await new GitHubAdapter(app).listBackfill(
      "acme/analytics",
      since,
    );
    expect(items).toEqual([
      expect.objectContaining({
        externalId: "acme/analytics#30",
        kind: "pull_request",
        state: "merged",
      }),
    ]);
    expect(read.pullPages).toBe(1);
  });
});
