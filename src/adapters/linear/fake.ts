/** LinearSource that serves a sample Linear workspace for Acme Analytics, used without LINEAR_API_KEY, for demo projects and in tests. Exports FakeLinearSource, SAMPLE_LINEAR_WORKSPACE. */
import {
  LinearError,
  type LinearInitiative,
  type LinearProject,
  type LinearSource,
  type LinearTeam,
} from "./source";

const mobile: LinearInitiative = {
  id: "sample-initiative-mobile",
  name: "Dashboards on the go",
  description:
    "Customers can check their dashboards and get alerts from a phone.",
  status: "Planned",
  targetDate: "2027-06-30",
  targetDateResolution: "quarter",
  priority: 2,
  sortOrder: 1,
};

const darkMode: LinearInitiative = {
  id: "sample-initiative-dark-mode",
  name: "Dark mode",
  description:
    "Dashboards are comfortable to read at night and on office wall screens.",
  status: "Active",
  targetDate: "2027-02-01",
  targetDateResolution: "month",
  priority: 3,
  sortOrder: 2,
};

const euData: LinearInitiative = {
  id: "sample-initiative-eu-data",
  name: "Customers can keep their data in the EU",
  description:
    "Accounts can choose to store and process their data in an EU region.",
  status: "Planned",
  targetDate: "2027-12-31",
  targetDateResolution: "year",
  priority: 1,
  sortOrder: 3,
};

function project(
  fields: Partial<LinearProject> & Pick<LinearProject, "id" | "name">,
): LinearProject {
  return {
    description: "",
    status: "planned",
    targetDate: null,
    targetDateResolution: null,
    priority: 0,
    sortOrder: 0,
    initiatives: [],
    ...fields,
  };
}

/** The sample workspace: two teams, their projects and the initiatives those belong to. */
export const SAMPLE_LINEAR_WORKSPACE: {
  team: LinearTeam;
  projects: LinearProject[];
}[] = [
  {
    team: { id: "sample-team-product", name: "Product" },
    projects: [
      project({
        id: "sample-project-mobile-viewer",
        name: "Mobile dashboard viewer",
        description: "Read-only dashboards in a layout that fits a phone.",
        targetDate: "2027-05-14",
        priority: 2,
        sortOrder: 1,
        initiatives: [mobile],
      }),
      project({
        id: "sample-project-push-alerts",
        name: "Metric alerts by push notification",
        description:
          "Notify people on their phone when a metric crosses a threshold they set.",
        status: "backlog",
        priority: 3,
        sortOrder: 2,
        initiatives: [mobile],
      }),
      project({
        id: "sample-project-dark-theme",
        name: "Dark theme for dashboards and reports",
        description: "A dark colour theme that follows the system setting.",
        status: "started",
        targetDate: "2027-02-01",
        targetDateResolution: "month",
        priority: 2,
        sortOrder: 3,
        initiatives: [darkMode],
      }),
      project({
        id: "sample-project-wall-screen",
        name: "Wall-screen display mode",
        description: "Full-screen dashboards that refresh themselves.",
        priority: 4,
        sortOrder: 4,
        initiatives: [darkMode],
      }),
      project({
        id: "sample-project-templates",
        name: "Dashboard template gallery",
        description:
          "Start a new dashboard from a template for common metrics.",
        targetDate: "2027-01-01",
        targetDateResolution: "halfYear",
        priority: 3,
        sortOrder: 5,
      }),
      project({
        id: "sample-project-comments",
        name: "Dashboard comments",
        description: "Discuss a chart next to the data.",
        status: "completed",
        sortOrder: 6,
      }),
      project({
        id: "sample-project-report-builder",
        name: "Rewrite the legacy report builder",
        status: "canceled",
        sortOrder: 7,
      }),
    ],
  },
  {
    team: { id: "sample-team-platform", name: "Platform" },
    projects: [
      project({
        id: "sample-project-eu-region",
        name: "EU data region",
        description:
          "Run the app and its database in an EU region and route EU accounts to it.",
        targetDate: "2027-07-01",
        targetDateResolution: "quarter",
        priority: 1,
        sortOrder: 1,
        initiatives: [euData],
      }),
      project({
        id: "sample-project-eu-backups",
        name: "Region-aware backups",
        description: "Keep each account's backups in the region it chose.",
        status: "backlog",
        priority: 3,
        sortOrder: 2,
        initiatives: [euData],
      }),
      project({
        id: "sample-project-push-service",
        name: "Push notification service",
        description: "Send push notifications to the iOS and Android apps.",
        targetDate: "2027-04-01",
        targetDateResolution: "month",
        priority: 2,
        sortOrder: 3,
        initiatives: [mobile],
      }),
    ],
  },
];

/** Serves SAMPLE_LINEAR_WORKSPACE through the LinearSource interface. */
export class FakeLinearSource implements LinearSource {
  async listTeams(): Promise<LinearTeam[]> {
    return SAMPLE_LINEAR_WORKSPACE.map((entry) => entry.team);
  }

  async readTeamProjects(
    teamId: string,
  ): Promise<{ team: LinearTeam; projects: LinearProject[] }> {
    const entry = SAMPLE_LINEAR_WORKSPACE.find(
      (candidate) => candidate.team.id === teamId,
    );
    if (!entry) throw new LinearError("That Linear team was not found.");
    return entry;
  }
}
