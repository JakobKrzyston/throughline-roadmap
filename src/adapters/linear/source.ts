/** The LinearSource interface the Linear roadmap import reads through, and the shapes it returns. Exports LinearSource, LinearTeam, LinearProject, LinearInitiative, LinearDateResolution, LinearError. */

/** A Linear team, whose projects are imported together. */
export type LinearTeam = {
  id: string;
  name: string;
};

/** How precise a Linear target date is: a day (null), or the month, quarter, half or year it falls in. */
export type LinearDateResolution =
  "month" | "quarter" | "halfYear" | "year" | null;

/** A Linear initiative: a workspace-level goal that groups projects. */
export type LinearInitiative = {
  id: string;
  name: string;
  /** Empty when the initiative has none. */
  description: string;
  /** Linear's InitiativeStatus, e.g. "Planned", "Active", "Completed" or "Canceled". */
  status: string;
  /** An ISO date, or null when no target is set. */
  targetDate: string | null;
  targetDateResolution: LinearDateResolution;
  /** 0 for none, then 1 (urgent) to 4 (low). */
  priority: number;
  /** Linear's manual order: lower comes first. */
  sortOrder: number;
};

/** A Linear project of one team, with the initiatives it belongs to. */
export type LinearProject = {
  id: string;
  name: string;
  /** Linear's short summary; empty when there is none. */
  description: string;
  /** Linear's project status type: "backlog", "planned", "started", "paused", "completed" or "canceled". */
  status: string;
  /** An ISO date, or null when no target is set. */
  targetDate: string | null;
  targetDateResolution: LinearDateResolution;
  /** 0 for none, then 1 (urgent) to 4 (low). */
  priority: number;
  /** Linear's manual order: lower comes first. */
  sortOrder: number;
  /** Every initiative the project belongs to. */
  initiatives: LinearInitiative[];
  /** Every team the project is shared with, including the team it was read from. */
  teams: LinearTeam[];
};

/** Reads the roadmap of a Linear workspace: its teams, and each team's projects. */
export interface LinearSource {
  /**
   * List the workspace's teams.
   *
   * Returns:
   *   Every team the API key can read, in the order Linear returns them.
   *
   * Raises:
   *   LinearError: Linear could not be read.
   */
  listTeams(): Promise<LinearTeam[]>;

  /**
   * Read one team and all of its projects that are not archived, including projects it shares
   * with other teams.
   *
   * Every page is read before this returns, so a failure part way never yields a partial list.
   *
   * Args:
   *   teamId: The team's Linear id.
   *
   * Returns:
   *   The team and its projects, whatever their status.
   *
   * Raises:
   *   LinearError: The team was not found, or Linear could not be read.
   */
  readTeamProjects(
    teamId: string,
  ): Promise<{ team: LinearTeam; projects: LinearProject[] }>;
}

/** Why a Linear import cannot go ahead, worded for the person importing. Nothing has been saved. */
export class LinearError extends Error {
  name = "LinearError";
}
