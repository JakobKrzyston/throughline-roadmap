/** SourceAdapter for GitHub, authenticated as a GitHub App through Octokit. Exports GitHubAdapter, GitHubApp. */
import { type App, type Octokit, RequestError } from "octokit";

import type {
  SourceAdapter,
  SourceChangedFile,
  SourceItem,
  SourceRepository,
} from "@/adapters/source";

import {
  githubIssueSchema,
  githubPullFileSchema,
  githubPullSchema,
  issueToItem,
  pullFileToChangedFile,
  pullToWorkItem,
} from "./work-items";

// GitHub's largest page size.
const PAGE_SIZE = 100;

/** The parts of an Octokit `App` the adapter uses. */
export type GitHubApp = Pick<App, "octokit" | "getInstallationOctokit">;

/** Reads repositories, issues and pull requests through a GitHub App installation. */
export class GitHubAdapter implements SourceAdapter {
  readonly source = "github";

  /**
   * Args:
   *   app: The GitHub App, authenticated with its id and private key.
   */
  constructor(private readonly app: GitHubApp) {}

  /**
   * Look up a repository the GitHub App is installed on.
   *
   * Args:
   *   fullName: `owner/name`.
   *
   * Returns:
   *   The repository, or null if it does not exist or the app is not installed on it.
   */
  async findRepository(fullName: string): Promise<SourceRepository | null> {
    const [owner, repo] = fullName.split("/");
    try {
      const octokit = await this.installationOctokit(owner, repo);
      const { data } = await octokit.rest.repos.get({ owner, repo });
      return { externalId: String(data.id), fullName: data.full_name };
    } catch (error) {
      if (error instanceof RequestError && error.status === 404) return null;
      throw error;
    }
  }

  /**
   * List one page of open issues, then pull requests merged on or after mergedSince. Issues
   * labelled `feedback` come back as feedback.
   *
   * The cursor is `issues:<page>` or `pulls:<page>`, GitHub's page numbers for each listing.
   *
   * Args:
   *   repository: The repository to read.
   *   mergedSince: Oldest merge date to include.
   *   cursor: The previous page's nextCursor, or null to start with the first page of issues.
   *
   * Returns:
   *   The page's items and the next cursor, or null after the last page.
   */
  async listBackfillPage(
    repository: SourceRepository,
    mergedSince: Date,
    cursor: string | null,
  ): Promise<{ items: SourceItem[]; nextCursor: string | null }> {
    const [owner, repo] = repository.fullName.split("/");
    const octokit = await this.installationOctokit(owner, repo);
    const [listing, pageText] = (cursor ?? "issues:1").split(":");
    const page = Number(pageText);

    if (listing === "issues") {
      const { data } = await octokit.rest.issues.listForRepo({
        owner,
        repo,
        state: "open",
        per_page: PAGE_SIZE,
        page,
      });
      const items = data
        .map((issue) => githubIssueSchema.parse(issue))
        .filter((issue) => !issue.pull_request)
        .map((issue) => issueToItem(repository.externalId, issue));
      const nextCursor =
        data.length === PAGE_SIZE ? `issues:${page + 1}` : "pulls:1";
      return { items, nextCursor };
    }

    // Most recently updated first. A PR merged after mergedSince was also updated after it,
    // so paging can stop at the first page that reaches older updates.
    const { data } = await octokit.rest.pulls.list({
      owner,
      repo,
      state: "closed",
      sort: "updated",
      direction: "desc",
      per_page: PAGE_SIZE,
      page,
    });
    const items = data
      .map((raw) => githubPullSchema.parse(raw))
      .filter(
        (pull) => pull.merged_at && new Date(pull.merged_at) >= mergedSince,
      )
      .map((pull) => pullToWorkItem(repository.externalId, pull));
    const last = data.at(-1);
    const more =
      data.length === PAGE_SIZE &&
      last !== undefined &&
      new Date(last.updated_at) >= mergedSince;
    return { items, nextCursor: more ? `pulls:${page + 1}` : null };
  }

  /**
   * List the files a pull request changed, with their diffs where GitHub provides them.
   *
   * Args:
   *   repository: The repository the pull request belongs to.
   *   workItemExternalId: The pull request's work item id, e.g. `1043219876#41`.
   *
   * Returns:
   *   The changed files. GitHub returns at most 3000.
   */
  async listChangedFiles(
    repository: SourceRepository,
    workItemExternalId: string,
  ): Promise<SourceChangedFile[]> {
    const [owner, repo] = repository.fullName.split("/");
    const octokit = await this.installationOctokit(owner, repo);
    const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
      owner,
      repo,
      pull_number: Number(workItemExternalId.split("#")[1]),
      per_page: 100,
    });
    return files.map((file) =>
      pullFileToChangedFile(githubPullFileSchema.parse(file)),
    );
  }

  private async installationOctokit(
    owner: string,
    repo: string,
  ): Promise<Octokit> {
    const { data: installation } =
      await this.app.octokit.rest.apps.getRepoInstallation({ owner, repo });
    return this.app.getInstallationOctokit(installation.id);
  }
}
