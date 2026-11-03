/** The SourceAdapter interface that brings issues and PRs into Throughline. Exports SourceAdapter, SourceWorkItem, SourceRepository. */

/** An issue or pull request as a source reports it, before it is stored as a work item. */
export type SourceWorkItem = {
  source: "github";
  /** Stable id within the source, e.g. `JakobKrzyston/throughline-roadmap#41`. */
  externalId: string;
  kind: "issue" | "pull_request";
  title: string;
  /** Full description. Link references are read from it; only an excerpt is stored. */
  body: string;
  url: string;
  state: "open" | "closed" | "merged";
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
   * List the work items to import when a repository is connected.
   *
   * Args:
   *   fullName: `owner/name`.
   *   mergedSince: Oldest merge date of pull requests to include.
   *
   * Returns:
   *   Every open issue, plus pull requests merged on or after mergedSince.
   */
  listBackfill(fullName: string, mergedSince: Date): Promise<SourceWorkItem[]>;
}
