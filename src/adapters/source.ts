/** The SourceAdapter interface that brings issues and PRs into Throughline. Exports SourceAdapter, SourceWorkItem, SourceRepository, SourceChangedFile. */

/** An issue or pull request as a source reports it, before it is stored as a work item. */
export type SourceWorkItem = {
  source: "github";
  /** Stable id within the source that survives repository renames, e.g. `1043219876#41` (repository id, then number). */
  externalId: string;
  kind: "issue" | "pull_request";
  title: string;
  /** Full description. Link references are read from it; only an excerpt is stored. */
  body: string;
  url: string;
  /** For an issue, `closed` means done and `not_planned` means closed without doing it. */
  state: "open" | "closed" | "merged" | "not_planned";
  mergedAt: Date | null;
  closedAt: Date | null;
};

/** A repository the source can read. */
export type SourceRepository = {
  /** Stable id that survives renames, e.g. GitHub's numeric repository id. */
  externalId: string;
  /** `owner/name`. */
  fullName: string;
};

/** One file a pull request changed. */
export type SourceChangedFile = {
  path: string;
  status: "added" | "modified" | "removed" | "renamed";
  additions: number;
  deletions: number;
  /** The unified diff for this file, or null when the source omits it (binary or very large files). */
  patch: string | null;
};

/** Reads repositories and their work items from one source, such as GitHub. */
export interface SourceAdapter {
  readonly source: SourceWorkItem["source"];

  /**
   * Look up a repository Throughline has been given access to.
   *
   * Args:
   *   fullName: `owner/name`.
   *
   * Returns:
   *   The repository, or null if it does not exist or Throughline cannot read it.
   */
  findRepository(fullName: string): Promise<SourceRepository | null>;

  /**
   * List one page of the work items to import when a repository is connected.
   *
   * Pages are small enough to sync in one job, so a long import is spread over many jobs and a
   * retry repeats only the page that failed.
   *
   * Args:
   *   repository: The repository to read.
   *   mergedSince: Oldest merge date of pull requests to include.
   *   cursor: Where to continue, from the previous page's `nextCursor`; null for the first page.
   *
   * Returns:
   *   The page's items and the cursor for the next page, or null after the last page. Across all
   *   pages: every open issue, plus pull requests merged on or after mergedSince.
   */
  listBackfillPage(
    repository: SourceRepository,
    mergedSince: Date,
    cursor: string | null,
  ): Promise<{ items: SourceWorkItem[]; nextCursor: string | null }>;

  /**
   * List the files a pull request changed.
   *
   * Args:
   *   repository: The repository the pull request belongs to.
   *   workItemExternalId: The pull request's SourceWorkItem.externalId.
   *
   * Returns:
   *   The changed files, in the order the source lists them.
   */
  listChangedFiles(
    repository: SourceRepository,
    workItemExternalId: string,
  ): Promise<SourceChangedFile[]>;
}
