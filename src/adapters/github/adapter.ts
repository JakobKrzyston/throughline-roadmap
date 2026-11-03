/** SourceAdapter for GitHub, authenticated as a GitHub App through Octokit. Exports GitHubAdapter, GitHubApp. */
import { type App, type Octokit, RequestError } from "octokit";

import type {
  SourceAdapter,
  SourceChangedFile,
  SourceRepository,
  SourceWorkItem,
} from "@/adapters/source";

import {
  githubIssueSchema,
  githubPullFileSchema,
  githubPullSchema,
  issueToWorkItem,
  pullFileToChangedFile,
  pullToWorkItem,
} from "./work-items";

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
   * List open issues plus pull requests merged on or after mergedSince.
   *
   * Args:
   *   repository: The repository to read.
   *   mergedSince: Oldest merge date to include.
   *
   * Returns:
   *   The work items.
   */
  async listBackfill(
    repository: SourceRepository,
    mergedSince: Date,
  ): Promise<SourceWorkItem[]> {
    const [owner, repo] = repository.fullName.split("/");
    const octokit = await this.installationOctokit(owner, repo);

    const openIssues = await octokit.paginate(octokit.rest.issues.listForRepo, {
      owner,
      repo,
      state: "open",
      per_page: 100,
    });
    const items = openIssues
      .map((issue) => githubIssueSchema.parse(issue))
      .filter((issue) => !issue.pull_request)
      .map((issue) => issueToWorkItem(repository.externalId, issue));

    // Most recently updated first. A PR merged after mergedSince was also updated after it,
    // so paging can stop at the first page that reaches older updates.
    const pages = octokit.paginate.iterator(octokit.rest.pulls.list, {
      owner,
      repo,
      state: "closed",
      sort: "updated",
      direction: "desc",
      per_page: 100,
    });
    for await (const { data } of pages) {
      for (const raw of data) {
        const pull = githubPullSchema.parse(raw);
        if (pull.merged_at && new Date(pull.merged_at) >= mergedSince) {
          items.push(pullToWorkItem(repository.externalId, pull));
        }
      }
      const last = data.at(-1);
      if (!last || new Date(last.updated_at) < mergedSince) break;
    }
    return items;
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
