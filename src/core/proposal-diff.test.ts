/** Tests for describeOperations, the review queue's readable diff. */
import { describe, expect, it } from "vitest";

import { operationListSchema } from "./operations";
import { describeOperations, type GraphSnapshot } from "./proposal-diff";

const PULL_ID = "6f1c1e0e-4c7d-4a43-9b0e-6f2a1c9d5e11";

const graph: GraphSnapshot = {
  outcomes: new Map([
    [
      "OUT-1",
      {
        title: "Customers can export reports",
        description: "",
        target: "2026-Q4",
        priority: 1,
      },
    ],
  ]),
  requirements: new Map([
    [
      "TL-4",
      {
        title: "Excel export",
        description: "Write .xlsx files.",
        status: "in_progress",
        userVisible: true,
        productNote: null,
        target: "2026-Q4",
      },
    ],
  ]),
  workItems: new Map([
    [PULL_ID, { title: "Excel export writer", kind: "pull_request" }],
  ]),
};

const describe_ = (ops: unknown[]) =>
  describeOperations(operationListSchema.parse(ops), graph);

describe("describeOperations", () => {
  it("shows a move with the old target and the note for the change feed", () => {
    expect(
      describe_([
        {
          type: "update_outcome",
          outcome_key: "OUT-1",
          target: "2027-Q1",
          product_note: "Exports come first.",
        },
        { type: "update_requirement", requirement_key: "TL-4", target: null },
      ]),
    ).toEqual([
      {
        heading: "Update outcome OUT-1: Customers can export reports",
        changes: [
          { field: "Target", before: "2026-Q4", after: "2027-Q1" },
          { field: "Product note", after: "Exports come first." },
        ],
      },
      {
        heading: "Update TL-4: Excel export",
        changes: [{ field: "Target", before: "2026-Q4", after: null }],
      },
    ]);
  });

  it("shows a status change with the current status", () => {
    expect(
      describe_([
        {
          type: "set_status",
          requirement_key: "TL-4",
          status: "done",
          product_note: "Customers can download Excel files.",
        },
      ]),
    ).toEqual([
      {
        heading: "Change the status of TL-4: Excel export",
        changes: [
          { field: "Status", before: "In progress", after: "Done" },
          {
            field: "Product note",
            after: "Customers can download Excel files.",
          },
        ],
      },
    ]);
  });

  it("shows a split's reason, note and new pieces", () => {
    const [entry] = describe_([
      {
        type: "split_requirement",
        requirement_key: "TL-4",
        split_reason: "Formatting is separate.",
        product_note: "Formatting comes next.",
        children: [
          { key: "TL-25", title: "Workbook export", status: "done" },
          { key: "TL-26", title: "Formatting", user_visible: true },
        ],
      },
    ]);
    expect(entry.heading).toBe("Split TL-4: Excel export into 2 pieces");
    expect(entry.changes).toEqual([
      {
        field: "Status",
        before: "In progress",
        after: "Worked out from its pieces",
      },
      { field: "Why", after: "Formatting is separate." },
      { field: "Product note", after: "Formatting comes next." },
      { field: "New piece TL-25", after: "Workbook export (Done)" },
      {
        field: "New piece TL-26",
        after: "Formatting (Planned, visible to customers)",
      },
    ]);
  });

  it("shows only the fields an update sets, with before and after", () => {
    const [entry] = describe_([
      {
        type: "update_requirement",
        requirement_key: "TL-4",
        description: "Built by the export job queue.",
        product_note: "Large reports no longer time out.",
      },
    ]);
    expect(entry.changes).toEqual([
      {
        field: "Description",
        before: "Write .xlsx files.",
        after: "Built by the export job queue.",
      },
      {
        field: "Product note",
        before: null,
        after: "Large reports no longer time out.",
      },
    ]);
  });

  it("names the work item in a link", () => {
    const [entry] = describe_([
      {
        type: "link_work_item",
        requirement_key: "TL-4",
        work_item_id: PULL_ID,
        relation: "part_of",
        confidence: "suggested",
      },
    ]);
    expect(entry).toEqual({
      heading: 'Link pull request "Excel export writer" to TL-4: Excel export',
      changes: [{ field: "Relation", after: "Part of it" }],
    });
  });

  it("falls back to keys for things the same proposal creates", () => {
    const entries = describe_([
      { type: "create_outcome", key: "OUT-2", title: "Alerts", priority: 2 },
      {
        type: "create_requirement",
        key: "TL-30",
        outcome_key: "OUT-2",
        title: "Alert rules",
        user_visible: true,
      },
      { type: "update_outcome", outcome_key: "OUT-2", target: "2027-Q2" },
    ]);
    expect(entries.map((entry) => entry.heading)).toEqual([
      "New outcome OUT-2: Alerts",
      "New requirement TL-30 under OUT-2: Alert rules",
      "Update outcome OUT-2",
    ]);
    expect(entries[2].changes).toEqual([
      { field: "Target", before: null, after: "2027-Q2" },
    ]);
  });
});
