/** Tests for turning a reviewer's mapping choices into a paired import's operations. */
import { describe, expect, it } from "vitest";

import {
  type ImportMapping,
  mappingDecisionsSchema,
  resolveImportMapping,
} from "./import-mapping";
import { type GraphOperation, operationListSchema } from "./operations";

const operations: GraphOperation[] = operationListSchema.parse([
  { type: "create_outcome", key: "OUT-1", title: "Email reports" },
  { type: "create_outcome", key: "OUT-2", title: "Snowflake" },
  {
    type: "create_requirement",
    key: "TL-1",
    outcome_key: "OUT-1",
    title: "Worker",
    status: "done",
  },
]);

const mapping: ImportMapping = {
  records: { T1: "Worker", T2: "Upgrade Postgres" },
  outcomes: [],
  requirements: [
    { key: "TL-1", records: ["T1"], confidence: "high", reason: "Epic" },
  ],
  unplaced: [
    {
      requirement: {
        key: "TL-2",
        title: "Upgrade Postgres",
        description: "",
        user_visible: false,
        status: "planned",
        work_type: "tech_debt",
      },
      records: ["T2"],
      reason: "Upkeep",
      suggested_outcome_key: null,
    },
  ],
  left_out: [],
};

function resolve(decisions: unknown) {
  return resolveImportMapping(
    operations,
    mapping,
    mappingDecisionsSchema.parse(decisions),
  );
}

describe("resolveImportMapping", () => {
  it("moves a requirement and adds a placed item after the outcomes", () => {
    const result = resolve({
      moves: { "TL-1": "OUT-2" },
      placements: { "TL-2": "OUT-1" },
    });

    expect(result.ok && result.operations.slice(2)).toEqual([
      expect.objectContaining({
        key: "TL-1",
        outcome_key: "OUT-2",
        status: "done",
      }),
      expect.objectContaining({
        type: "create_requirement",
        key: "TL-2",
        outcome_key: "OUT-1",
        work_type: "tech_debt",
      }),
    ]);
  });

  it("drops an item left out", () => {
    const result = resolve({ placements: { "TL-2": null } });

    expect(result).toEqual({ ok: true, operations });
  });

  it("refuses while an item has no decision", () => {
    expect(resolve({})).toEqual({
      ok: false,
      message: 'Place or leave out "Upgrade Postgres" before approving',
    });
  });

  it("refuses a move or placement for something the proposal does not have", () => {
    expect(resolve({ moves: { "TL-2": "OUT-1" } })).toMatchObject({
      ok: false,
    });
    expect(
      resolve({ placements: { "TL-1": "OUT-1", "TL-2": null } }),
    ).toMatchObject({ ok: false });
  });
});
