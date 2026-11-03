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

/** A fake GitHub App installed on acme/analytics only. Serves issue and PR pages by page number. */
function fakeApp(options: {
  issuePages?: unknown[][];
  pullPages?: ReturnType<typeof pull>[][];
  pullFiles?: unknown[];
}) {
  const read = { pullNumber: 0 };
  const listFiles = () => {};
  const octokit = {
    rest: {
      repos: {
        get: async () => ({
          data: { id: 4242, full_name: "acme/analytics" },
        }),
      },
      issues: {
        listForRepo: async ({ page }: { page: number }) => ({
          data: options.issuePages?.[page - 1] ?? [],
        }),
      },
      pulls: {
        list: async ({ page }: { page: number }) => ({
          data: options.pullPages?.[page - 1] ?? [],
        }),
        listFiles,
      },
    },
    paginate: async (endpoint: unknown, params: { pull_number?: number }) => {
      expect(endpoint).toBe(listFiles);
      read.pullNumber = params.pull_number ?? 0;
      return options.pullFiles ?? [];
    },
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

describe("GitHubAdapter.listBackfillPage", () => {
  const since = new Date("2026-08-01T00:00:00Z");
  const repository = { externalId: "4242", fullName: "acme/analytics" };
  const issue = (number: number, extra: object = {}) => ({
    number,
    title: `Issue ${number}`,
    body: "Part of TL-4",
    html_url: `https://github.com/acme/analytics/issues/${number}`,
    state: "open",
    closed_at: null,
    updated_at: "2026-10-01T00:00:00Z",
    ...extra,
  });

  it("returns open issues but not the pull requests the issues API mixes in", async () => {
    const { app } = fakeApp({
      issuePages: [[issue(7), issue(8, { pull_request: {} })]],
    });
    const page = await new GitHubAdapter(app).listBackfillPage(
      repository,
      since,
      null,
    );
    expect(page.items.map((item) => item.externalId)).toEqual(["4242#7"]);
    expect(page.items[0]).toMatchObject({
      kind: "issue",
      body: "Part of TL-4",
    });
    // A short page is the last page of issues, so pull requests come next.
    expect(page.nextCursor).toBe("pulls:1");
  });

  it("moves to the next page of issues after a full one", async () => {
    const full = Array.from({ length: 100 }, (_, i) => issue(i + 1));
    const { app } = fakeApp({ issuePages: [full, [issue(101)]] });
    const adapter = new GitHubAdapter(app);

    const first = await adapter.listBackfillPage(repository, since, null);
    expect(first.items).toHaveLength(100);
    expect(first.nextCursor).toBe("issues:2");

    const second = await adapter.listBackfillPage(
      repository,
      since,
      "issues:2",
    );
    expect(second.items.map((item) => item.externalId)).toEqual(["4242#101"]);
    expect(second.nextCursor).toBe("pulls:1");
  });

  it("returns pull requests merged since the cutoff", async () => {
    const { app } = fakeApp({
      pullPages: [
        [
          pull(30, "2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z"),
          pull(29, null, "2026-09-01T00:00:00Z"), // closed without merging
          pull(28, "2026-07-01T00:00:00Z", "2026-07-15T00:00:00Z"), // merged before the cutoff
        ],
      ],
    });
    const page = await new GitHubAdapter(app).listBackfillPage(
      repository,
      since,
      "pulls:1",
    );
    expect(page.items).toEqual([
      expect.objectContaining({
        externalId: "4242#30",
        kind: "pull_request",
        state: "merged",
      }),
    ]);
    expect(page.nextCursor).toBeNull();
  });

  it("stops paging pull requests at the first page that reaches older updates", async () => {
    const recent = Array.from({ length: 99 }, (_, i) =>
      pull(200 - i, "2026-10-01T00:00:00Z", "2026-10-01T00:00:00Z"),
    );
    const { app } = fakeApp({
      pullPages: [
        [...recent, pull(50, "2026-10-01T00:00:00Z", "2026-10-01T00:00:00Z")],
        [...recent, pull(10, "2026-06-01T00:00:00Z", "2026-06-01T00:00:00Z")],
      ],
    });
    const adapter = new GitHubAdapter(app);
    expect(
      (await adapter.listBackfillPage(repository, since, "pulls:1")).nextCursor,
    ).toBe("pulls:2");
    expect(
      (await adapter.listBackfillPage(repository, since, "pulls:2")).nextCursor,
    ).toBeNull();
  });
});

describe("GitHubAdapter.listChangedFiles", () => {
  it("reads the pull request's files and maps GitHub's statuses", async () => {
    const { app, read } = fakeApp({
      pullFiles: [
        {
          filename: "src/export/xlsx.ts",
          status: "added",
          additions: 120,
          deletions: 0,
          patch: "@@ -0,0 +1,120 @@",
        },
        {
          filename: "assets/logo.png",
          status: "changed",
          additions: 0,
          deletions: 0,
        },
      ],
    });
    const files = await new GitHubAdapter(app).listChangedFiles(
      { externalId: "4242", fullName: "acme/analytics" },
      "4242#41",
    );
    expect(read.pullNumber).toBe(41);
    expect(files).toEqual([
      {
        path: "src/export/xlsx.ts",
        status: "added",
        additions: 120,
        deletions: 0,
        patch: "@@ -0,0 +1,120 @@",
      },
      {
        path: "assets/logo.png",
        status: "modified",
        additions: 0,
        deletions: 0,
        patch: null,
      },
    ]);
  });
});
