/** Tests for GitHubAdapter against a fake Octokit app. */
import { generateKeyPairSync } from "node:crypto";

import { App, Octokit, RequestError } from "octokit";
import { describe, expect, it } from "vitest";

import { GitHubAdapter, type GitHubApp, GitHubError } from "./adapter";

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

describe("GitHubAdapter.findRepository failures", () => {
  const validKey = generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString();

  /** A real Octokit App whose requests go to `fetch` instead of GitHub. */
  function appWith(privateKey: string, fetch: typeof globalThis.fetch) {
    const adapter = new GitHubAdapter(
      new App({
        appId: "1",
        privateKey,
        // Octokit retries failed requests with backoff; one attempt keeps the tests fast.
        Octokit: Octokit.defaults({
          request: { fetch },
          retry: { enabled: false },
        }),
      }),
    );
    return adapter.findRepository("acme/analytics");
  }

  const answer = (status: number) => async () =>
    new Response(JSON.stringify({ message: "nope" }), {
      status,
      headers: { "content-type": "application/json" },
    });

  it("says the private key cannot be used when it does not parse, without calling GitHub", async () => {
    let called = false;
    const fetch = async () => {
      called = true;
      return new Response("{}");
    };
    // A PEM pasted with its line breaks turned into spaces.
    const mangled = validKey.replace(/\n/g, " ");
    const failure = appWith(mangled, fetch);
    await expect(failure).rejects.toThrow(GitHubError);
    await expect(failure).rejects.toThrow(/private key cannot be used/);
    expect(called).toBe(false);
  });

  it("says the credentials were refused when GitHub answers 401", async () => {
    await expect(appWith(validKey, answer(401))).rejects.toThrow(
      /did not accept the app's credentials/,
    );
  });

  it("names the status when GitHub answers with another error", async () => {
    await expect(appWith(validKey, answer(502))).rejects.toThrow(
      "GitHub answered with an error (status 502). Please try again in a few minutes.",
    );
    await expect(appWith(validKey, answer(403))).rejects.toThrow(
      /status 403\)\. The server log/,
    );
  });

  it("says GitHub could not be reached when the request never gets an answer", async () => {
    const fetch = async () => {
      throw new TypeError("fetch failed", {
        cause: new Error("getaddrinfo ENOTFOUND api.github.com"),
      });
    };
    await expect(appWith(validKey, fetch)).rejects.toThrow(
      "Could not reach GitHub. Please try again.",
    );
  });

  it("keeps Octokit's error as the cause for the server log", async () => {
    const failure = await appWith(validKey, answer(502)).catch((e) => e);
    expect(failure.cause).toBeInstanceOf(RequestError);
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

  it("returns issues labelled feedback as feedback", async () => {
    const { app } = fakeApp({
      issuePages: [[issue(7, { labels: ["feedback"] }), issue(9)]],
    });
    const page = await new GitHubAdapter(app).listBackfillPage(
      repository,
      since,
      null,
    );
    expect(page.items.map((item) => item.kind)).toEqual(["feedback", "issue"]);
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
