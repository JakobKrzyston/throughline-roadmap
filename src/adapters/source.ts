/** The SourceAdapter interface that brings issues, PRs and customer feedback into Throughline, from GitHub or Linear. Exports SourceAdapter, SourceItem, SourceWorkItem, SourceFeedback, SourceRepository, SourceChangedFile. */

/** An issue or pull request as a source reports it, before it is stored as a work item. */
export type SourceWorkItem = {
  source: "github" | "linear";
  /**
   * Stable id within the source that survives renames: for GitHub `1043219876#41` (repository id,
   * then number), for Linear the issue's id.
   */
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
  /**
   * Linear only: the issue is in a started state, such as In Progress. GitHub leaves it out,
   * because there an open pull request is what shows work has started.
   */
  started?: boolean;
  /**
   * Linear only: the issue belongs to a Linear project, so it is roadmap work worth a link
   * suggestion when it completes without a reference. Most bugs and chores belong to none.
   */
  inProject?: boolean;
  /** Linear only: the issue's id as people see it, e.g. `ENG-41`. It changes if the issue moves team. */
  identifier?: string;
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

/** A repository the source can read, or for Linear a team. */
export type SourceRepository = {
  /** Stable id that survives renames, e.g. GitHub's numeric repository id or a Linear team's id. */
  externalId: string;
  /** `owner/name` for GitHub, the team key (e.g. `ENG`) for Linear. */
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

/** Reads repositories (or Linear teams) and their work items from one source, GitHub or Linear. */
export interface SourceAdapter {
  readonly source: SourceWorkItem["source"];

  /**
   * Look up a repository Throughline has been given access to.
   *
   * Args:
   *   fullName: `owner/name`, or a Linear team key.
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
   *   mergedSince: Oldest merge date of pull requests to include, or for Linear the oldest
   *     completion date of issues.
   *   cursor: Where to continue, from the previous page's `nextCursor`; null for the first page.
   *
   * Returns:
   *   The page's items and the cursor for the next page, or null after the last page. Across all
   *   pages: every open issue (as feedback when the source counts it as feedback), plus pull
   *   requests merged on or after mergedSince (for Linear, issues completed on or after it).
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
   *   The changed files, in the order the source lists them. Empty for a source without code
   *   changes, such as Linear.
   */
  listChangedFiles(
    repository: SourceRepository,
    workItemExternalId: string,
  ): Promise<SourceChangedFile[]>;
}
