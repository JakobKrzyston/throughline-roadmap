/** Realistic roadmap exports from Jira, Productboard and Notion, each with the proposal demo mode returns for it. Exports IMPORT_SAMPLES, ImportSample, importFixturesFor. */
import type { z } from "zod";

import type { FakeFixtures } from "@/adapters/llm/fake";

import { DEMO_LLM_FIXTURES, SAMPLE_IMPORT_OUTPUT } from "./fixtures";
import { IMPORT_TASK, type importOutputSchema } from "./import";

/** A sample export the import page offers, and the model output demo mode serves for it. */
export type ImportSample = {
  id: string;
  /** Button label, e.g. "Jira CSV". */
  label: string;
  content: string;
  output: z.input<typeof importOutputSchema>;
};

// A Jira Cloud "Export CSV (all fields)", trimmed to a few columns but with the usual noise:
// internal ids, a repeated Labels column, empty cells, and finished and abandoned work.
const JIRA_CSV = `Summary,Issue key,Issue id,Issue Type,Status,Project key,Priority,Assignee,Reporter,Created,Updated,Fix Version/s,Labels,Labels,Sprint,Parent,Parent summary,Due date,Custom field (Story Points),Description
Scheduled reporting,ANLT-100,10100,Initiative,In Progress,ANLT,High,Dana Ruiz,Dana Ruiz,04/Aug/26 9:12 AM,21/Oct/26 3:40 PM,,reporting,,,,,30/Jun/27,,"Customers want reports to arrive in their inbox instead of logging in every Monday."
Scheduled email reports,ANLT-112,10112,Epic,To Do,ANLT,High,Sam Okafor,Dana Ruiz,04/Aug/26 9:20 AM,19/Oct/26 11:02 AM,2027.2,reporting,email,,10100,Scheduled reporting,30/Jun/27,,"Let a customer schedule any dashboard to be emailed daily, weekly or monthly."
Schedule builder in the dashboard share menu,ANLT-131,10131,Story,To Do,ANLT,Medium,Priya Shah,Sam Okafor,12/Aug/26 2:05 PM,12/Aug/26 2:05 PM,2027.2,frontend,,ANLT Sprint 41,10112,Scheduled email reports,,5,"Pick frequency, time zone and recipients. Validate recipient emails."
Email delivery worker with retries,ANLT-132,10132,Story,To Do,ANLT,Medium,,Sam Okafor,12/Aug/26 2:09 PM,02/Sep/26 10:30 AM,2027.2,backend,,,10112,Scheduled email reports,,8,"Queue-backed worker that sends scheduled emails through SES, retries bounces, and records delivery."
Render dashboards to PDF for attachments,ANLT-133,10133,Story,In Progress,ANLT,Medium,Lee Chen,Sam Okafor,12/Aug/26 2:15 PM,20/Oct/26 4:44 PM,2027.2,backend,pdf,ANLT Sprint 42,10112,Scheduled email reports,,8,"Headless Chromium render of a dashboard at the scheduled time, attached to the email."
Slack delivery for scheduled reports,ANLT-118,10118,Epic,Won't Do,ANLT,Low,,Dana Ruiz,05/Aug/26 10:00 AM,30/Sep/26 9:15 AM,,reporting,slack,,10100,Scheduled reporting,,,"Dropped after discovery: customers who asked wanted email."
Warehouse connectors,ANLT-101,10101,Initiative,To Do,ANLT,Highest,Dana Ruiz,Dana Ruiz,04/Aug/26 9:14 AM,21/Oct/26 3:41 PM,,connectors,,,,,,,"Analyse data where it already lives instead of uploading CSVs."
Snowflake connector,ANLT-140,10140,Epic,To Do,ANLT,Highest,Ana Costa,Dana Ruiz,06/Aug/26 1:00 PM,18/Oct/26 9:00 AM,2027.3,connectors,snowflake,,10101,Warehouse connectors,15/Aug/27,,
Snowflake key-pair authentication,ANLT-141,10141,Story,To Do,ANLT,High,Ana Costa,Ana Costa,06/Aug/26 1:30 PM,06/Aug/26 1:30 PM,2027.3,backend,security,,10140,Snowflake connector,,5,"Store the customer's key pair encrypted; never accept passwords."
Incremental sync for Snowflake tables,ANLT-142,10142,Story,To Do,ANLT,High,Ana Costa,Ana Costa,06/Aug/26 1:34 PM,11/Sep/26 5:20 PM,2027.3,backend,,,10140,Snowflake connector,,13,"Sync only changed rows using a watermark column the customer picks."
BigQuery connector,ANLT-150,10150,Epic,To Do,ANLT,High,Ana Costa,Dana Ruiz,06/Aug/26 1:05 PM,18/Oct/26 9:01 AM,2027.4,connectors,bigquery,,10101,Warehouse connectors,,,
BigQuery service account setup,ANLT-151,10151,Story,To Do,ANLT,Medium,,Ana Costa,07/Aug/26 9:00 AM,07/Aug/26 9:00 AM,2027.4,backend,,,10150,BigQuery connector,,5,"Customer uploads a service account key scoped to read-only datasets."
Map nested and repeated BigQuery fields,ANLT-152,10152,Story,To Do,ANLT,Medium,,Ana Costa,07/Aug/26 9:05 AM,07/Aug/26 9:05 AM,2027.4,backend,,,10150,BigQuery connector,,8,"Flatten STRUCT and ARRAY columns into tables our query engine can join."
Legacy CSV uploader cleanup,ANLT-120,10120,Epic,Done,ANLT,Low,Lee Chen,Dana Ruiz,04/Aug/26 9:30 AM,15/Sep/26 2:00 PM,2026.9,tech-debt,,,10101,Warehouse connectors,,,"Removed the old uploader code path."
Tune connection pool for sync workers,ANLT-160,10160,Task,To Do,ANLT,Medium,Lee Chen,Lee Chen,10/Sep/26 4:00 PM,10/Sep/26 4:00 PM,,infra,,,,,,3,"Sync workers exhaust the Postgres pool during large backfills."
`;

const JIRA_OUTPUT: ImportSample["output"] = {
  rationale:
    "Each epic became an outcome under its initiative, and its stories became requirements; the epic due dates and fix versions set the targets. The Slack delivery epic is marked Won't Do and the CSV uploader cleanup is already Done, so both were left out. The unparented connection pool task went under the Snowflake connector, whose syncs it unblocks.",
  outcomes: [
    {
      title: "Customers get their dashboards by email on a schedule",
      description:
        "Customers choose a dashboard, how often and who should receive it, and it arrives in their inbox as a PDF.",
      target: "2027-Q2",
      priority: 1,
      requirements: [
        {
          title: "Schedule builder in the share menu",
          description:
            "Pick frequency, time zone and recipients from the dashboard share menu, with recipient email validation.",
          user_visible: true,
          work_type: "feature",
          product_note: null,
        },
        {
          title: "Email delivery worker",
          description:
            "Queue-backed worker that sends scheduled emails through SES, retries bounces and records delivery.",
          user_visible: false,
          work_type: "infrastructure",
          product_note: null,
        },
        {
          title: "Dashboard PDF rendering",
          description:
            "Headless Chromium renders the dashboard at the scheduled time and attaches it to the email.",
          user_visible: true,
          work_type: "feature",
          product_note: "Scheduled emails include the dashboard as a PDF.",
        },
      ],
    },
    {
      title: "Customers can analyse their Snowflake data directly",
      description:
        "Customers connect Snowflake and analyse their tables without exporting and uploading files.",
      target: "2027-Q3",
      priority: 2,
      requirements: [
        {
          title: "Snowflake key-pair authentication",
          description:
            "Store the customer's key pair encrypted; never accept passwords.",
          user_visible: true,
          work_type: "security",
          product_note: null,
        },
        {
          title: "Incremental Snowflake table sync",
          description:
            "Sync only changed rows, using a watermark column the customer picks.",
          user_visible: true,
          work_type: "feature",
          product_note: null,
        },
        {
          title: "Sync worker connection pool tuning",
          description:
            "Stop sync workers exhausting the Postgres connection pool during large backfills.",
          user_visible: false,
          work_type: "infrastructure",
          product_note: null,
        },
      ],
    },
    {
      title: "Customers can analyse their BigQuery data directly",
      description:
        "Customers connect BigQuery and analyse their datasets without exporting and uploading files.",
      target: "2027-Q4",
      priority: 3,
      requirements: [
        {
          title: "BigQuery service account setup",
          description:
            "Customer uploads a service account key scoped to read-only datasets.",
          user_visible: true,
          work_type: "feature",
          product_note: null,
        },
        {
          title: "Nested and repeated BigQuery field mapping",
          description:
            "Flatten STRUCT and ARRAY columns into tables the query engine can join.",
          user_visible: false,
          work_type: "feature",
          product_note: null,
        },
      ],
    },
  ],
};

// A Productboard features export: objectives, features and subfeatures in one table, with ids,
// scores and URLs that are not part of the plan.
const PRODUCTBOARD_CSV = `"Feature ID","Name","Type","Parent ID","Parent name","Status","Owner","Timeframe","Release","Tags","Insights","User impact score","Description","URL"
"34120871","Grow self-serve expansion","objective","","","","dana@acme.example","2027 H1","","","","","Accounts add seats and products without talking to sales.","https://acme.productboard.com/objectives/34120871"
"34120902","Embedded dashboards","feature","34120871","Grow self-serve expansion","Planned","sam@acme.example","Jan 2027 - Mar 2027","2027 Q1","embed;platform","27","412","Customers put Acme dashboards inside their own product for their users.","https://acme.productboard.com/features/34120902"
"34120915","Signed embed tokens","subfeature","34120902","Embedded dashboards","Planned","ana@acme.example","Jan 2027 - Mar 2027","2027 Q1","embed;security","4","","Short-lived JWTs scoped to one dashboard and row-level filters.","https://acme.productboard.com/features/34120915"
"34120918","Embed theming","subfeature","34120902","Embedded dashboards","Candidate","priya@acme.example","Jan 2027 - Mar 2027","2027 Q1","embed","9","","Match the host app's fonts and colours.","https://acme.productboard.com/features/34120918"
"34120920","Embed SDK for React","subfeature","34120902","Embedded dashboards","Planned","priya@acme.example","Jan 2027 - Mar 2027","2027 Q1","embed;sdk","6","","npm package with a <Dashboard> component and typed events.","https://acme.productboard.com/features/34120920"
"34120940","Team workspaces","feature","34120871","Grow self-serve expansion","In progress","lee@acme.example","Apr 2027 - Jun 2027","2027 Q2","workspaces","31","388","Separate spaces for each team with their own dashboards and members.","https://acme.productboard.com/features/34120940"
"34120944","Workspace roles","subfeature","34120940","Team workspaces","In progress","lee@acme.example","Apr 2027 - Jun 2027","2027 Q2","workspaces;permissions","12","","Admin, editor and viewer roles per workspace.","https://acme.productboard.com/features/34120944"
"34120947","Move dashboards between workspaces","subfeature","34120940","Team workspaces","Planned","lee@acme.example","Apr 2027 - Jun 2027","2027 Q2","workspaces","3","","","https://acme.productboard.com/features/34120947"
"34120951","Workspace data migration","subfeature","34120940","Team workspaces","Planned","ana@acme.example","Apr 2027 - Jun 2027","2027 Q2","workspaces;migration","","","Backfill a default workspace for every existing account.","https://acme.productboard.com/features/34120951"
"34120960","Usage-based pricing page","feature","34120871","Grow self-serve expansion","New idea","dana@acme.example","","","pricing","2","","Not yet evaluated.","https://acme.productboard.com/features/34120960"
"34120880","CSV export","feature","","","Released","sam@acme.example","Jul 2026 - Sep 2026","2026 Q3","export","40","455","","https://acme.productboard.com/features/34120880"
`;

const PRODUCTBOARD_OUTPUT: ImportSample["output"] = {
  rationale:
    "Each feature under the objective became an outcome and its subfeatures became requirements, with timeframes as targets. The pricing page is still a new idea and CSV export is already released, so both were left out. The workspace data migration is internal work, placed under team workspaces.",
  outcomes: [
    {
      title: "Customers can embed Acme dashboards in their own product",
      description:
        "Customers show live dashboards to their own users inside their app, styled to match it.",
      target: "2027-Q1",
      priority: 1,
      requirements: [
        {
          title: "Signed embed tokens",
          description:
            "Short-lived JWTs scoped to one dashboard and its row-level filters.",
          user_visible: false,
          work_type: "security",
          product_note: null,
        },
        {
          title: "React embed SDK",
          description:
            "npm package with a Dashboard component and typed events.",
          user_visible: true,
          work_type: "feature",
          product_note: null,
        },
        {
          title: "Embed theming",
          description: "Match the host app's fonts and colours.",
          user_visible: true,
          work_type: "feature",
          product_note: "Embedded dashboards can match a customer's own brand.",
        },
      ],
    },
    {
      title: "Teams get their own workspaces",
      description:
        "Each team has its own space with its own dashboards and members, and admins decide who can edit.",
      target: "2027-Q2",
      priority: 2,
      requirements: [
        {
          title: "Workspace roles",
          description: "Admin, editor and viewer roles per workspace.",
          user_visible: true,
          work_type: "feature",
          product_note: null,
        },
        {
          title: "Move dashboards between workspaces",
          description:
            "Move a dashboard, with its permissions, to another workspace.",
          user_visible: true,
          work_type: "feature",
          product_note: null,
        },
        {
          title: "Default workspace backfill",
          description:
            "Migration that creates a default workspace for every existing account.",
          user_visible: false,
          work_type: "infrastructure",
          product_note: null,
        },
      ],
    },
  ],
};

// A Notion page exported as Markdown & CSV: property lines, links to sub-pages with ids in their
// names, and sections that are not planned work.
const NOTION_MARKDOWN = `# 2027 Product Roadmap

Owner: Dana Ruiz
Last edited time: October 21, 2026 3:42 PM
Status: Draft
Tags: Planning, H1

> 💡 This page is the source of truth for H1. Specs live in the linked sub-pages.

## Now (Q1)

### Ask questions in plain English

Status: In progress
Spec: [Ask Acme spec](Ask%20Acme%20spec%203f9c1e0b7d2a4c8e9b1a6d5f4e3c2b1a.md)

People who don't know SQL want answers without waiting for an analyst.

- [ ] Natural-language to SQL service with guardrails (read-only, row limits)
- [ ] "Ask" box on every dashboard that shows the chart it built
- [ ] Evaluation set of 200 real questions to track answer quality

### Comments on dashboards

Status: Not started
Spec: [Comments spec](Comments%20spec%208a1b2c3d4e5f60718293a4b5c6d7e8f9.md)

- [ ] Threaded comments pinned to a chart
- [ ] @mentions with email notifications

## Next (Q2)

### Faster dashboards

Big customers wait 10+ seconds for their main dashboard.

- [ ] Query result cache keyed by dashboard filters
- [ ] Upgrade the query engine to the new planner

## Later / parked

- Offline mode for the mobile app (parked until mobile usage grows)

## Open questions

- Do we charge extra for Ask Acme?
- Who moderates comments on shared dashboards?

## Success metrics

| Metric | Target |
| --- | --- |
| Weekly active askers | 30% of seats |
| p95 dashboard load | < 3 s |
`;

const NOTION_OUTPUT: ImportSample["output"] = {
  rationale:
    "Each heading under Now and Next is one customer capability, so each became an outcome with its checklist items as requirements. Offline mode is parked, and the open questions and success metrics are not work, so they were left out. The query engine upgrade is internal work, placed under faster dashboards.",
  outcomes: [
    {
      title: "Anyone can ask questions about their data in plain English",
      description:
        "People who don't know SQL type a question on a dashboard and get a chart that answers it.",
      target: "2027-Q1",
      priority: 1,
      requirements: [
        {
          title: "Natural-language to SQL service",
          description:
            "Translate questions to read-only SQL with row limits and other guardrails.",
          user_visible: false,
          work_type: "feature",
          product_note: null,
        },
        {
          title: "Ask box on dashboards",
          description:
            "Question box on every dashboard that shows the chart it built.",
          user_visible: true,
          work_type: "feature",
          product_note: null,
        },
        {
          title: "Answer quality evaluation set",
          description:
            "200 real questions with expected answers, run on every model or prompt change.",
          user_visible: false,
          work_type: "research",
          product_note: null,
        },
      ],
    },
    {
      title: "Teams can discuss a dashboard where they see it",
      description:
        "People comment on a chart and mention colleagues, who are told by email.",
      target: "2027-Q1",
      priority: 2,
      requirements: [
        {
          title: "Threaded chart comments",
          description: "Comment threads pinned to a chart.",
          user_visible: true,
          work_type: "feature",
          product_note: null,
        },
        {
          title: "Mentions with email notifications",
          description: "@mention a colleague in a comment and email them.",
          user_visible: true,
          work_type: "feature",
          product_note: null,
        },
      ],
    },
    {
      title: "Large dashboards load quickly",
      description:
        "The busiest dashboards open in a few seconds instead of keeping people waiting.",
      target: "2027-Q2",
      priority: 3,
      requirements: [
        {
          title: "Query result cache",
          description: "Cache query results keyed by dashboard filters.",
          user_visible: true,
          work_type: "feature",
          product_note: null,
        },
        {
          title: "Query engine planner upgrade",
          description: "Upgrade the query engine to the new planner.",
          user_visible: false,
          work_type: "tech_debt",
          product_note: null,
        },
      ],
    },
  ],
};

/** The samples, in the order the import page shows them. */
export const IMPORT_SAMPLES: ImportSample[] = [
  {
    id: "jira",
    label: "Jira CSV",
    content: JIRA_CSV,
    output: JIRA_OUTPUT,
  },
  {
    id: "productboard",
    label: "Productboard CSV",
    content: PRODUCTBOARD_CSV,
    output: PRODUCTBOARD_OUTPUT,
  },
  {
    id: "notion",
    label: "Notion Markdown",
    content: NOTION_MARKDOWN,
    output: NOTION_OUTPUT,
  },
];

// Browsers send textarea line breaks as CRLF, so compare without them.
function normalise(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

/**
 * The demo fixtures to serve for one roadmap: a sample's own proposal when the roadmap is that
 * sample unchanged, else the usual demo proposal.
 *
 * Args:
 *   roadmap: The roadmap text being imported.
 *
 * Returns:
 *   DEMO_LLM_FIXTURES with the import task's output chosen for this roadmap.
 */
export function importFixturesFor(roadmap: string): FakeFixtures {
  const sample = IMPORT_SAMPLES.find(
    (candidate) => normalise(candidate.content) === normalise(roadmap),
  );
  return {
    ...DEMO_LLM_FIXTURES,
    [IMPORT_TASK]: [sample?.output ?? SAMPLE_IMPORT_OUTPUT],
  };
}
