/** The "Acme Analytics" demo project. Builds the graph through approved proposals so it has a real event history. Exports seedDemoProject, DEMO_SLUG. */
import { and, eq } from "drizzle-orm";

import type { GraphOperationInput } from "@/core/operations";
import { outcomeTargetOperations, savePlanningChange } from "@/core/planning";
import { applyProposal } from "@/core/proposals";

import type { Database } from "./client";
import { projects, proposals, requirements, workItems } from "./schema";

export const DEMO_SLUG = "acme-analytics";
const REPO = "acme/analytics";
// Stands in for GitHub's numeric repository id, which work item ids are built from.
const REPO_ID = "100001";
const SEED_ACTOR = "demo-seed";

type WorkItemSeed = {
  number: number;
  kind: "issue" | "pull_request";
  state: "open" | "closed" | "merged";
  title: string;
  /** Requirement this work item implements, if it is linked. */
  implements?: string;
};

// prettier-ignore
const WORK_ITEMS: WorkItemSeed[] = [
  { number: 101, kind: "issue", state: "closed", title: "Export reports to CSV and Excel", implements: "TL-1" },
  { number: 102, kind: "pull_request", state: "merged", title: "Add background job queue", implements: "TL-2" },
  { number: 103, kind: "pull_request", state: "merged", title: "Retry failed jobs with backoff", implements: "TL-2" },
  { number: 104, kind: "pull_request", state: "merged", title: "CSV export endpoint", implements: "TL-3" },
  { number: 105, kind: "issue", state: "open", title: "Excel export", implements: "TL-4" },
  { number: 106, kind: "pull_request", state: "open", title: "Excel export with xlsx writer", implements: "TL-4" },
  { number: 107, kind: "issue", state: "open", title: "Export button in the report toolbar", implements: "TL-5" },
  { number: 108, kind: "issue", state: "closed", title: "Audit log for exports", implements: "TL-6" },
  { number: 109, kind: "pull_request", state: "open", title: "Schedule builder: frequency picker", implements: "TL-7" },
  { number: 110, kind: "issue", state: "open", title: "Schedule builder UI", implements: "TL-7" },
  { number: 111, kind: "pull_request", state: "merged", title: "Integrate transactional email provider", implements: "TL-9" },
  { number: 112, kind: "issue", state: "open", title: "Handle bounced and failed report emails", implements: "TL-10" },
  { number: 113, kind: "issue", state: "open", title: "Send scheduled reports in the customer's timezone", implements: "TL-11" },
  { number: 114, kind: "pull_request", state: "merged", title: "SAML login", implements: "TL-12" },
  { number: 115, kind: "pull_request", state: "merged", title: "SAML: support Okta and Azure AD metadata", implements: "TL-12" },
  { number: 116, kind: "pull_request", state: "merged", title: "SCIM user provisioning endpoints", implements: "TL-13" },
  { number: 117, kind: "pull_request", state: "merged", title: "SSO settings page for admins", implements: "TL-14" },
  { number: 118, kind: "issue", state: "open", title: "Dashboards are slow on large accounts", implements: "TL-15" },
  { number: 119, kind: "pull_request", state: "merged", title: "Redis client for query results", implements: "TL-17" },
  { number: 120, kind: "pull_request", state: "open", title: "Invalidate cached queries when data refreshes", implements: "TL-18" },
  { number: 121, kind: "issue", state: "open", title: "Cache hit-rate metrics", implements: "TL-19" },
  { number: 122, kind: "issue", state: "open", title: "Lazy-load widgets below the fold", implements: "TL-20" },
  { number: 123, kind: "issue", state: "open", title: "Public share links for dashboards", implements: "TL-21" },
  // Merged with explicit references or none at all; the pending proposals below are about these.
  { number: 124, kind: "pull_request", state: "merged", title: "Fix flaky CSV export test" },
  { number: 125, kind: "pull_request", state: "merged", title: "Excel export: multiple sheets and formatting", implements: "TL-4" },
];

// prettier-ignore
const ROADMAP: GraphOperationInput[] = [
  { type: "create_outcome", key: "OUT-1", title: "Customers can export reports to Excel and CSV", description: "Download any report as a spreadsheet to share or analyse further.", target: "2026-Q4", priority: 1 },
  { type: "create_requirement", key: "TL-1", outcome_key: "OUT-1", title: "Async export service", user_visible: true, product_note: "Exports run in the background so large reports don't time out." },
  { type: "create_requirement", key: "TL-6", outcome_key: "OUT-1", title: "Export audit log" },

  { type: "create_outcome", key: "OUT-2", title: "Customers can schedule reports by email", description: "Send a report to a list of people every day, week or month.", target: "2027-Q1", priority: 2 },
  { type: "create_requirement", key: "TL-7", outcome_key: "OUT-2", title: "Schedule builder UI", user_visible: true },
  { type: "create_requirement", key: "TL-8", outcome_key: "OUT-2", title: "Email delivery service" },
  { type: "create_requirement", key: "TL-11", outcome_key: "OUT-2", title: "Timezone-aware scheduling", user_visible: true },

  { type: "create_outcome", key: "OUT-3", title: "Enterprise customers can sign in with single sign-on", description: "Staff sign in with their company account, and IT controls who has access.", target: "2026-Q3", priority: 1 },
  { type: "create_requirement", key: "TL-12", outcome_key: "OUT-3", title: "SAML login", user_visible: true },
  { type: "create_requirement", key: "TL-13", outcome_key: "OUT-3", title: "SCIM user provisioning", user_visible: true },
  { type: "create_requirement", key: "TL-14", outcome_key: "OUT-3", title: "SSO admin settings page", user_visible: true },

  { type: "create_outcome", key: "OUT-4", title: "Dashboards load in under two seconds", description: "Large accounts see their dashboards without waiting.", target: "2027-Q1", priority: 3 },
  { type: "create_requirement", key: "TL-15", outcome_key: "OUT-4", title: "Query result cache" },
  { type: "create_requirement", key: "TL-20", outcome_key: "OUT-4", title: "Lazy-load dashboard widgets", user_visible: true },

  { type: "create_outcome", key: "OUT-5", title: "Customers can share a dashboard with a link", description: "Send a read-only dashboard to someone without an Acme account.", target: "2027-Q1", priority: 4 },
  { type: "create_requirement", key: "TL-21", outcome_key: "OUT-5", title: "Public link tokens" },
  { type: "create_requirement", key: "TL-22", outcome_key: "OUT-5", title: "Share dialog", user_visible: true },
];

const SPLITS: {
  trigger: number;
  summary: string;
  operations: GraphOperationInput[];
}[] = [
  {
    trigger: 102,
    summary: "Export needs background jobs, so it was split into four pieces",
    operations: [
      {
        type: "split_requirement",
        requirement_key: "TL-1",
        split_reason:
          "Large exports time out, so they need a background job queue first.",
        product_note:
          "Export took longer because it needed background-job infrastructure, which also unblocks scheduled reports.",
        children: [
          { key: "TL-2", title: "Background job queue" },
          { key: "TL-3", title: "CSV export", user_visible: true },
          { key: "TL-4", title: "Excel export", user_visible: true },
          {
            key: "TL-5",
            title: "Export button in report toolbar",
            user_visible: true,
          },
        ],
      },
    ],
  },
  {
    trigger: 111,
    summary: "Email delivery split into sending and failure handling",
    operations: [
      {
        type: "split_requirement",
        requirement_key: "TL-8",
        split_reason:
          "Bounce and retry handling is a separate piece of work from sending.",
        product_note:
          "Reports can be emailed; handling bounced emails is planned next.",
        children: [
          { key: "TL-9", title: "Email provider integration" },
          { key: "TL-10", title: "Retry and bounce handling" },
        ],
      },
    ],
  },
  {
    trigger: 119,
    summary: "Query cache split, then the cache layer split again",
    operations: [
      {
        type: "split_requirement",
        requirement_key: "TL-15",
        split_reason: "Caching and measuring the cache are separate jobs.",
        product_note:
          "Faster dashboards need a cache plus a way to measure how well it works.",
        children: [
          { key: "TL-16", title: "Cache layer" },
          { key: "TL-19", title: "Cache hit metrics" },
        ],
      },
      {
        type: "split_requirement",
        requirement_key: "TL-16",
        split_reason:
          "Clearing stale results when data refreshes turned out to be its own project.",
        product_note:
          "Dashboards must never show old numbers, so clearing the cache on refresh got its own step.",
        children: [
          { key: "TL-17", title: "Redis cache client" },
          { key: "TL-18", title: "Cache invalidation on data refresh" },
        ],
      },
    ],
  },
];

// prettier-ignore
const PROGRESS: GraphOperationInput[] = [
  { type: "set_status", requirement_key: "TL-2", status: "done" },
  { type: "set_status", requirement_key: "TL-3", status: "done", product_note: "Customers can now download any report as CSV." },
  { type: "set_status", requirement_key: "TL-4", status: "in_progress" },
  { type: "set_status", requirement_key: "TL-6", status: "dropped", product_note: "Export audit log is no longer planned; no customer asked for it." },
  { type: "set_status", requirement_key: "TL-7", status: "in_progress" },
  { type: "set_status", requirement_key: "TL-9", status: "done" },
  { type: "set_status", requirement_key: "TL-12", status: "done" },
  { type: "set_status", requirement_key: "TL-13", status: "done" },
  { type: "set_status", requirement_key: "TL-14", status: "done", product_note: "Single sign-on is ready for every enterprise customer." },
  { type: "set_status", requirement_key: "TL-17", status: "done" },
  { type: "set_status", requirement_key: "TL-18", status: "in_progress" },
];

/**
 * Create the Acme Analytics demo project, replacing it if it already exists.
 *
 * The graph is built by applying proposals, so every change has an event. A few proposals are
 * left pending for the review queue.
 *
 * Args:
 *   db: A migrated database.
 *
 * Returns:
 *   The id of the new demo project.
 */
export async function seedDemoProject(db: Database): Promise<string> {
  // Only ever replace a demo project; a real project with this slug makes the insert below fail instead.
  await db
    .delete(projects)
    .where(and(eq(projects.slug, DEMO_SLUG), eq(projects.isDemo, true)));
  const [project] = await db
    .insert(projects)
    .values({ name: "Acme Analytics", slug: DEMO_SLUG, isDemo: true })
    .returning();

  const inserted = await db
    .insert(workItems)
    .values(
      WORK_ITEMS.map((item) => ({
        projectId: project.id,
        source: "github" as const,
        externalId: `${REPO_ID}#${item.number}`,
        kind: item.kind,
        title: item.title,
        url: `https://github.com/${REPO}/${item.kind === "issue" ? "issues" : "pull"}/${item.number}`,
        state: item.state,
        mergedAt: item.state === "merged" ? new Date() : null,
        closedAt: item.state === "open" ? null : new Date(),
      })),
    )
    .returning({ id: workItems.id, externalId: workItems.externalId });
  const workItemId = (number: number): string =>
    inserted.find((item) => item.externalId === `${REPO_ID}#${number}`)!.id;

  async function propose(
    source: "import" | "reconcile" | "link_suggest" | "reschedule",
    summary: string,
    operations: GraphOperationInput[],
    extra: { trigger?: number; rationale?: string; requirement?: string } = {},
  ): Promise<string> {
    const [requirement] = extra.requirement
      ? await db
          .select({ id: requirements.id })
          .from(requirements)
          .where(
            and(
              eq(requirements.projectId, project.id),
              eq(requirements.key, extra.requirement),
            ),
          )
      : [];
    const [proposal] = await db
      .insert(proposals)
      .values({
        projectId: project.id,
        source,
        summary,
        rationale: extra.rationale ?? "",
        operations,
        triggerWorkItemId: extra.trigger ? workItemId(extra.trigger) : null,
        requirementId: requirement?.id ?? null,
      })
      .returning();
    return proposal.id;
  }

  const approve = async (...args: Parameters<typeof propose>): Promise<void> =>
    applyProposal(db, await propose(...args), SEED_ACTOR);

  await approve("import", "Import the Acme product roadmap", ROADMAP);
  for (const split of SPLITS) {
    await approve("reconcile", split.summary, split.operations, {
      trigger: split.trigger,
    });
  }
  await approve("reconcile", "Record progress so far", PROGRESS);
  await approve(
    "reconcile",
    "Link existing issues and pull requests",
    WORK_ITEMS.filter((item) => item.implements).map((item) => ({
      type: "link_work_item",
      requirement_key: item.implements!,
      work_item_id: workItemId(item.number),
      confidence: "explicit",
    })),
  );

  // A PM's own planning: dates for some requirements, and one outcome moved back a quarter.
  await savePlanningChange(
    db,
    project.id,
    "Plan dates for the scheduled reports work",
    [
      {
        type: "update_requirement",
        requirement_key: "TL-7",
        target: "2027-Q1",
      },
      {
        type: "update_requirement",
        requirement_key: "TL-10",
        target: "2027-Q2",
      },
      {
        type: "update_requirement",
        requirement_key: "TL-11",
        target: "2027-Q1",
      },
    ],
    SEED_ACTOR,
  );
  await savePlanningChange(
    db,
    project.id,
    "Move dashboard share links to Q2 2027",
    outcomeTargetOperations(
      { key: "OUT-5", target: "2027-Q1" },
      "2027-Q2",
      "Single sign-on and exports come first.",
    ),
    SEED_ACTOR,
  );

  // Left pending so the review queue has something in it.
  await propose(
    "reconcile",
    "Excel export is finished",
    [
      {
        type: "set_status",
        requirement_key: "TL-4",
        status: "done",
        product_note: "Customers can now download any report as an Excel file.",
      },
    ],
    {
      trigger: 125,
      requirement: "TL-4",
      rationale:
        "The merged pull request adds the Excel writer, multiple sheets and formatting, which covers everything TL-4 describes.",
    },
  );
  await propose(
    "link_suggest",
    "Link the flaky CSV test fix to CSV export",
    [
      {
        type: "link_work_item",
        requirement_key: "TL-3",
        work_item_id: workItemId(124),
        relation: "part_of",
        confidence: "suggested",
      },
    ],
    {
      trigger: 124,
      rationale:
        "The pull request has no requirement reference, but it only changes tests for the CSV export endpoint.",
    },
  );
  await propose(
    "reschedule",
    "Move scheduled email reports to Q2 2027",
    outcomeTargetOperations(
      { key: "OUT-2", target: "2027-Q1" },
      "2027-Q2",
      "Making sure bounced report emails are retried turned out to be its own piece of work.",
    ),
    {
      rationale:
        "Retry and bounce handling (TL-10) is planned for Q2 2027, after the outcome's Q1 2027 target, and scheduled reports should not ship while failed emails are silently lost.",
    },
  );
  await propose(
    "import",
    "Add an outcome for usage alerts",
    [
      {
        type: "create_outcome",
        key: "OUT-6",
        title: "Customers get an alert when usage passes a limit",
        description:
          "Admins hear about unusual usage before the invoice arrives.",
        target: "2027-Q2",
        priority: 5,
      },
      {
        type: "create_requirement",
        key: "TL-23",
        outcome_key: "OUT-6",
        title: "Usage threshold rules",
        user_visible: true,
      },
      {
        type: "create_requirement",
        key: "TL-24",
        outcome_key: "OUT-6",
        title: "Alert email and in-app notification",
        user_visible: true,
      },
    ],
    {
      rationale:
        "Imported from the Q2 planning notes, which list usage alerts as a top request from finance teams.",
    },
  );

  return project.id;
}
