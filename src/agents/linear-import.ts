/** Linear roadmap import: a Linear team's initiatives and projects mapped, without a model, to one pending proposal of outcomes and requirements. Exports runLinearImport, planFromLinear, linearTarget. */
import {
  LinearError,
  type LinearDateResolution,
  type LinearProject,
  type LinearSource,
  type LinearTeam,
} from "@/adapters/linear/source";
import type { Database } from "@/db/client";

import { count } from "./context";
import { type ImportPlan, saveImportProposal } from "./import";

// The import records planned work, as file imports do: finished and dropped projects stay out.
const LEFT_OUT_STATUSES = ["completed", "canceled"];

/**
 * Turn a Linear target date into a Throughline target.
 *
 * Linear stores a month, quarter, half or year as one day inside it. Throughline has quarters
 * and days, so a month becomes its quarter, and a half or a year becomes its last quarter, the
 * latest the target allows.
 *
 * Args:
 *   date: The ISO target date, or null.
 *   resolution: How precise the date is; null for a day.
 *
 * Returns:
 *   A quarter such as "2027-Q2", the date itself, or null when there is no date.
 */
export function linearTarget(
  date: string | null,
  resolution: LinearDateResolution,
): string | null {
  if (!date) return null;
  if (!resolution) return date;
  const year = date.slice(0, 4);
  const quarter = Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1;
  if (resolution === "year") return `${year}-Q4`;
  if (resolution === "halfYear") return `${year}-Q${quarter <= 2 ? 2 : 4}`;
  return `${year}-Q${quarter}`;
}

/**
 * Map a Linear team's projects to an import plan.
 *
 * Each initiative becomes an outcome and its projects become requirements. A project in no
 * initiative becomes an outcome with itself as the only requirement, since a Linear project is
 * usually one capability that ships on its own. So does an open project whose initiatives are all
 * canceled: the work is still planned, and the rationale names these apart. A project in several
 * initiatives goes under the first by priority, then Linear's order. Outcomes are numbered in that
 * same order, initiatives first. Completed and canceled projects, and canceled initiatives, are
 * left out. Projects shared with other teams are kept and counted in the rationale, since
 * importing those teams proposes them again.
 *
 * Args:
 *   team: The team the projects belong to; it becomes each requirement's team.
 *   projects: The team's projects, as Linear returns them.
 *
 * Returns:
 *   The plan, or null when no project is left to import.
 */
export function planFromLinear(
  team: LinearTeam,
  projects: LinearProject[],
): ImportPlan | null {
  const open = projects.filter(
    (project) => !LEFT_OUT_STATUSES.includes(project.status),
  );
  if (open.length === 0) return null;

  const byInitiative = new Map<
    string,
    {
      initiative: LinearProject["initiatives"][number];
      projects: LinearProject[];
    }
  >();
  const standalone: LinearProject[] = [];
  let inSeveral = 0;
  let initiativesCanceled = 0;
  let shared = 0;
  const otherTeams = new Set<string>();
  for (const project of open) {
    const others = project.teams.filter((other) => other.id !== team.id);
    if (others.length > 0) shared++;
    others.forEach((other) => otherTeams.add(other.name));

    const homes = project.initiatives
      .filter((initiative) => initiative.status !== "Canceled")
      .sort(byPriority);
    if (homes.length > 1) inSeveral++;
    if (homes.length === 0) {
      if (project.initiatives.length > 0) initiativesCanceled++;
      standalone.push(project);
      continue;
    }
    const group = byInitiative.get(homes[0].id) ?? {
      initiative: homes[0],
      projects: [],
    };
    group.projects.push(project);
    byInitiative.set(homes[0].id, group);
  }

  const teamName = team.name.trim().slice(0, 60);
  const requirement = (project: LinearProject) => ({
    title: project.name,
    description: project.description,
    // Linear does not say which work customers can see; the reviewer sets it.
    user_visible: false,
    work_type: null,
    product_note: null,
    target: linearTarget(project.targetDate, project.targetDateResolution),
    team: teamName || null,
  });

  const groups = [...byInitiative.values()].sort((a, b) =>
    byPriority(a.initiative, b.initiative),
  );
  const outcomes = [
    ...groups.map(({ initiative, projects: grouped }) => ({
      title: initiative.name,
      description: initiative.description,
      target: linearTarget(
        initiative.targetDate,
        initiative.targetDateResolution,
      ),
      requirements: grouped.sort(byPriority).map(requirement),
    })),
    ...standalone.sort(byPriority).map((project) => ({
      title: project.name,
      description: project.description,
      target: linearTarget(project.targetDate, project.targetDateResolution),
      requirements: [requirement(project)],
    })),
  ].map((outcome, index) => ({ ...outcome, priority: index + 1 }));

  return {
    rationale: rationale(team.name, {
      open: open.length,
      noInitiative: standalone.length - initiativesCanceled,
      initiativesCanceled,
      leftOut: projects.length - open.length,
      inSeveral,
      shared,
      otherTeams: [...otherTeams].sort(),
    }),
    outcomes,
  };
}

/**
 * Read a Linear team and save its roadmap as one pending import proposal.
 *
 * Linear is read in full before anything is written, and the proposal is written in one
 * transaction, so a failure saves nothing. The graph only changes when someone approves it.
 *
 * Args:
 *   db: Database to write the proposal to.
 *   linear: Where to read the team from.
 *   projectId: Project the roadmap belongs to.
 *   teamId: The Linear team's id.
 *
 * Returns:
 *   The new proposal's id and its one-line summary.
 *
 * Raises:
 *   LinearError: Linear could not be read, or the team has no open projects.
 */
export async function runLinearImport(
  db: Database,
  linear: LinearSource,
  projectId: string,
  teamId: string,
): Promise<{ proposalId: string; summary: string }> {
  const { team, projects } = await linear.readTeamProjects(teamId);
  const plan = planFromLinear(team, projects);
  if (!plan) {
    throw new LinearError(
      `The Linear team ${team.name} has no open projects to import.`,
    );
  }
  return saveImportProposal(
    db,
    projectId,
    plan,
    `the Linear team ${team.name}`,
  );
}

// Linear priorities run 1 (urgent) to 4 (low), with 0 for none, which sorts last.
function byPriority(
  a: { priority: number; sortOrder: number },
  b: { priority: number; sortOrder: number },
): number {
  const rank = (priority: number) => (priority === 0 ? 5 : priority);
  return rank(a.priority) - rank(b.priority) || a.sortOrder - b.sortOrder;
}

function rationale(
  teamName: string,
  counts: {
    open: number;
    noInitiative: number;
    initiativesCanceled: number;
    leftOut: number;
    inSeveral: number;
    shared: number;
    otherTeams: string[];
  },
): string {
  const sentences = [
    `Read ${count(counts.open, "open project")} from the Linear team ${teamName}. Each initiative became an outcome, with its projects as requirements.`,
  ];
  const ownOutcome = (n: number) =>
    n === 1 ? "an outcome of its own" : "outcomes of their own";
  if (counts.noInitiative > 0) {
    sentences.push(
      `${count(counts.noInitiative, "project")} in no initiative became ${ownOutcome(counts.noInitiative)}.`,
    );
  }
  if (counts.initiativesCanceled > 0) {
    sentences.push(
      `${count(counts.initiativesCanceled, "open project")} whose initiatives are all canceled became ${ownOutcome(counts.initiativesCanceled)}; leave ${counts.initiativesCanceled === 1 ? "it" : "them"} out if the work was dropped with the initiative.`,
    );
  }
  if (counts.inSeveral > 0) {
    sentences.push(
      `${count(counts.inSeveral, "project")} in more than one initiative ${counts.inSeveral === 1 ? "is" : "are"} under the highest-priority one.`,
    );
  }
  if (counts.shared > 0) {
    const teams = counts.otherTeams.join(", ");
    sentences.push(
      `${count(counts.shared, "project")} ${counts.shared === 1 ? "is" : "are"} shared with ${teams}. Importing ${counts.otherTeams.length === 1 ? "that team" : "those teams"} proposes ${counts.shared === 1 ? "it" : "them"} again, so approve ${counts.shared === 1 ? "it" : "them"} only once.`,
    );
  }
  if (counts.leftOut > 0) {
    sentences.push(
      `Left out ${count(counts.leftOut, "completed or canceled project")}.`,
    );
  }
  sentences.push(
    "Linear does not say which work customers can see, so no requirement is marked as visible to customers: set that, and reword outcomes for customers, before approving.",
  );
  return sentences.join(" ");
}
