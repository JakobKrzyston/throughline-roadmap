/** Canned agent inputs and model outputs, used by tests and by demo mode when no API key is set. Exports SAMPLE_ROADMAP, SAMPLE_IMPORT_OUTPUT, SAMPLE_PULL_FILES, SAMPLE_RECONCILE_OUTPUTS, DEMO_LLM_FIXTURES (including the feedback agent's). */
import type { z } from "zod";

import type { FakeFixtures } from "@/adapters/llm/fake";
import type { SourceChangedFile } from "@/adapters/source";

import { FEEDBACK_MATCH_TASK } from "./feedback-match";
import { IMPORT_TASK, type importOutputSchema } from "./import";
import { LINK_SUGGEST_TASK } from "./link-suggest";
import { RECONCILE_TASK, type reconcileOutputSchema } from "./reconcile";
import { SLIP_TASK } from "./slip";

/** A short roadmap of the kind a PM might paste. */
export const SAMPLE_ROADMAP = `# Acme Analytics – H1 2027

## 1. Mobile app (Q2)
Customers keep asking to check dashboards on the go.
- iOS and Android app shell with login
- Read-only dashboard viewer optimised for small screens
- Push notification service

## 2. Anomaly alerts
Notify account owners when a metric moves unexpectedly.
- Anomaly detection job over daily metrics
- Alert settings page
`;

/** What the import agent's model returns for SAMPLE_ROADMAP. */
export const SAMPLE_IMPORT_OUTPUT: z.input<typeof importOutputSchema> = {
  rationale:
    "The roadmap lists two numbered initiatives, so each became an outcome in that order. Only the mobile app has a stated quarter.",
  outcomes: [
    {
      title: "Customers can view their dashboards on a phone",
      description:
        "A mobile app for iOS and Android shows dashboards wherever customers are.",
      target: "2027-Q2",
      priority: 1,
      requirements: [
        {
          title: "Mobile app shell with login",
          description: "React Native app for iOS and Android with SSO login.",
          user_visible: true,
          work_type: "feature",
          product_note: null,
        },
        {
          title: "Mobile dashboard viewer",
          description: "Read-only dashboard rendering for small screens.",
          user_visible: true,
          work_type: "feature",
          product_note: "Dashboards are view-only on mobile at first.",
        },
        {
          title: "Push notification service",
          description: "APNs and FCM delivery for mobile notifications.",
          user_visible: false,
          work_type: "infrastructure",
          product_note: null,
        },
      ],
    },
    {
      title: "Customers are alerted when a metric changes unexpectedly",
      description:
        "Account owners hear about unusual movements without watching dashboards all day.",
      target: null,
      priority: 2,
      requirements: [
        {
          title: "Anomaly detection job",
          description:
            "Nightly job that flags metrics outside their expected range.",
          user_visible: false,
          work_type: "infrastructure",
          product_note: null,
        },
        {
          title: "Alert settings page",
          description: "Let account owners choose which metrics alert them.",
          user_visible: true,
          work_type: "feature",
          product_note: null,
        },
      ],
    },
  ],
};

/** Files changed by the demo's "Excel export: multiple sheets and formatting" pull request. */
export const SAMPLE_PULL_FILES: SourceChangedFile[] = [
  {
    path: "src/export/xlsx-writer.ts",
    status: "added",
    additions: 184,
    deletions: 0,
    patch:
      "@@ -0,0 +1,184 @@\n+export async function writeWorkbook(report: Report): Promise<Buffer> {\n+  const workbook = new Workbook();\n+  for (const section of report.sections) addSheet(workbook, section);",
  },
  {
    path: "src/export/jobs.ts",
    status: "modified",
    additions: 12,
    deletions: 3,
    patch:
      "@@ -20,3 +20,12 @@\n-  if (format !== 'csv') throw new UnsupportedFormat(format);\n+  if (format === 'xlsx') return writeWorkbook(report);",
  },
  {
    path: "pnpm-lock.yaml",
    status: "modified",
    additions: 40,
    deletions: 2,
    patch: "@@ -1,2 +1,40 @@\n+  exceljs: 4.4.0",
  },
];

type ReconcileOutputInput = z.input<typeof reconcileOutputSchema>;

/** One model output per classification, for reconciling the demo's Excel export (TL-4) against that pull request. */
export const SAMPLE_RECONCILE_OUTPUTS = {
  fully_done: {
    classification: "fully_done",
    summary: "Excel export is finished",
    rationale:
      "The pull request adds an Excel writer and hooks it into the export jobs, which covers everything TL-4 describes. The toolbar button is a separate requirement.",
    product_note: "Customers can now download any report as an Excel file.",
    built: null,
    split: null,
  },
  partially_done: {
    classification: "partially_done",
    summary: "Excel export works; formatting is still to come",
    rationale:
      "The writer produces one plain sheet per report section. Number formats and column widths, which the requirement mentions, are not in the diff.",
    product_note:
      "Customers can download reports as Excel files today. Formatted spreadsheets with proper number and date styles are planned next.",
    built: null,
    split: {
      reason:
        "The Excel writer shipped without cell formatting, which is a separate piece of work.",
      pieces: [
        {
          title: "Excel workbook export",
          description: "One sheet per report section, plain values.",
          user_visible: true,
          shipped: true,
          work_type: "feature",
        },
        {
          title: "Excel cell formatting",
          description: "Number and date formats, column widths.",
          user_visible: true,
          shipped: false,
          work_type: "feature",
        },
      ],
    },
  },
  done_differently: {
    classification: "done_differently",
    summary: "Excel export shipped as a background job",
    rationale:
      "The plan described exporting from the browser, but the pull request builds workbooks in the background job queue instead.",
    product_note:
      "Customers can now download reports as Excel files. They are built in the background, so even very large reports download without timing out.",
    built: {
      title: "Excel export via background jobs",
      description:
        "Workbooks are written server-side by the export job queue and downloaded when ready.",
    },
    split: null,
  },
  scope_grew: {
    classification: "scope_grew",
    summary: "Excel export needs a streaming writer for very large reports",
    rationale:
      "The pull request handles normal reports but notes that reports over a million rows run out of memory, which needs a streaming writer the plan did not include.",
    product_note:
      "Customers can download most reports as Excel files now. The very largest reports need extra work, which is now planned.",
    built: null,
    split: {
      reason:
        "Building whole workbooks in memory fails for reports over a million rows.",
      pieces: [
        {
          title: "Excel export for standard reports",
          description: "In-memory workbook writer.",
          user_visible: true,
          shipped: true,
          work_type: "feature",
        },
        {
          title: "Streaming Excel writer",
          description: "Write rows in chunks so huge reports fit in memory.",
          user_visible: true,
          shipped: false,
          work_type: "feature",
        },
      ],
    },
  },
} satisfies Record<string, ReconcileOutputInput>;

/** Fixtures the fake provider serves in demo mode, whatever the input. Worded to fit any requirement. */
export const DEMO_LLM_FIXTURES: FakeFixtures = {
  [IMPORT_TASK]: [SAMPLE_IMPORT_OUTPUT],
  [RECONCILE_TASK]: [
    {
      classification: "fully_done",
      summary: "This requirement looks finished",
      rationale:
        "Demo mode: no AI key is set up, so this is a sample answer rather than a real comparison of the work with the plan.",
      product_note: "This piece of work is now finished.",
      built: null,
      split: null,
    } satisfies ReconcileOutputInput,
  ],
  // A sample link could name a requirement the project does not have, so demo mode suggests none.
  [LINK_SUGGEST_TASK]: [
    {
      requirement_key: null,
      relation: "implements",
      rationale: "Demo mode: no AI key is set up, so no link is suggested.",
    },
  ],
  // A sample date could fall before the outcome's own target, so demo mode keeps the target.
  [SLIP_TASK]: [
    {
      new_target: null,
      summary: "Keep the target",
      rationale:
        "Demo mode: no AI key is set up, so the target is not judged and stays as it is.",
      reason: "The plan is unchanged.",
    },
  ],
  // A sample outcome could be one the project does not have, so demo mode matches none, and every
  // piece of feedback lands in one group that says why it is not sorted.
  [FEEDBACK_MATCH_TASK]: [
    {
      outcome_key: null,
      theme: "Not sorted: no AI key is set up",
      rationale: "Demo mode: no AI key is set up, so feedback is not matched.",
    },
  ],
};
