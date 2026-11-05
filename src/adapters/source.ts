/** The SourceAdapter interface that brings issues, PRs and customer feedback into Throughline. Exports SourceAdapter, SourceItem, SourceWorkItem, SourceFeedback, SourceRepository, SourceChangedFile. */

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
  /** Logins of the people working on it: a pull request's author and the item's assignees. Bots are left out. */
  people: string[];
  mergedAt: Date | null;
  closedAt: Date | null;
  /** When the source last changed the item. Used to ignore deliveries that arrive out of order. */
  updatedAt: Date;
};

/** Customer feedback as a source reports it, such as a GitHub issue labelled `feedback`. */
export type SourceFeedback = {
  source: "github";
  kind: "feedback";
  /** Stable id within the source, in the same form as SourceWorkItem.externalId. */
  externalId: string;
  title: string;
  /** Full text. Only an excerpt is stored. */
  body: string;
  url: string;
  /** When the source last changed it. Used to ignore deliveries that arrive out of order. */
  updatedAt: Date;
};

/** Anything a source delivers: a work item, or feedback. `kind` tells them apart. */
export type SourceItem = SourceWorkItem | SourceFeedback;

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
   *   pages: every open issue (as feedback when the source counts it as feedback), plus pull
   *   requests merged on or after mergedSince.
   */
  listBackfillPage(
    repository: SourceRepository,
    mergedSince: Date,
    cursor: string | null,
  ): Promise<{ items: SourceItem[]; nextCursor: string | null }>;

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
