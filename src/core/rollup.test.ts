/** Tests for the progress and product-status rollups in rollup.ts. */
import { describe, expect, it } from "vitest";

import type { LeafStatus } from "./operations";
import {
  outcomeProgress,
  productStatus,
  type RequirementNode,
  requirementProgress,
  statusCounts,
  type TeamNode,
  teamProgress,
} from "./rollup";

const leaf = (status: LeafStatus, userVisible = false): RequirementNode => ({
  status,
  userVisible,
  children: [],
});

const parent = (...children: RequirementNode[]): RequirementNode => ({
  status: null,
  userVisible: false,
  children,
});

describe("a single leaf", () => {
  it("is 1 when done and 0 otherwise", () => {
    expect(requirementProgress(leaf("done"))).toBe(1);
    expect(requirementProgress(leaf("in_progress"))).toBe(0);
    expect(requirementProgress(leaf("planned"))).toBe(0);
  });

  it("drives the outcome status on its own", () => {
    expect(productStatus([leaf("planned")])).toBe("not_started");
    expect(productStatus([leaf("in_progress")])).toBe("in_progress");
    expect(productStatus([leaf("done")])).toBe("delivered");
  });
});

describe("nested splits", () => {
  // Root split into two children; one child split again into two grandchildren.
  const tree = parent(leaf("done"), parent(leaf("done"), leaf("planned")));

  it("counts every leaf equally at any depth", () => {
    expect(requirementProgress(tree)).toBeCloseTo(2 / 3);
    expect(requirementProgress(tree.children[1])).toBe(0.5);
  });

  it("is delivered only when every leaf is done", () => {
    expect(productStatus([tree])).toBe("in_progress");
    expect(
      productStatus([parent(leaf("done"), parent(leaf("done"), leaf("done")))]),
    ).toBe("delivered");
  });

  it("averages across all of an outcome's roots", () => {
    expect(outcomeProgress([tree, leaf("planned")])).toBe(0.5);
  });
});

describe("dropped leaves", () => {
  it("are left out of progress", () => {
    expect(requirementProgress(parent(leaf("done"), leaf("dropped")))).toBe(1);
  });

  it("do not stop an outcome being delivered", () => {
    expect(productStatus([leaf("done"), parent(leaf("dropped"))])).toBe(
      "delivered",
    );
  });

  it("leave nothing to count when every leaf is dropped", () => {
    expect(requirementProgress(parent(leaf("dropped")))).toBe(0);
    expect(productStatus([leaf("dropped")])).toBe("not_started");
  });
});

describe("partially_available versus in_progress", () => {
  it("is partially_available once a user-visible leaf is done", () => {
    expect(productStatus([leaf("done", true), leaf("planned")])).toBe(
      "partially_available",
    );
  });

  it("stays in_progress when only behind-the-scenes work is done", () => {
    expect(productStatus([leaf("done", false), leaf("planned", true)])).toBe(
      "in_progress",
    );
  });

  it("does not count a dropped user-visible leaf", () => {
    expect(productStatus([leaf("dropped", true), leaf("in_progress")])).toBe(
      "in_progress",
    );
  });
});

describe("an empty outcome", () => {
  it("has no progress and has not started", () => {
    expect(outcomeProgress([])).toBe(0);
    expect(productStatus([])).toBe("not_started");
  });
});

describe("status counts", () => {
  it("counts each outcome once under its status, zero for the rest", () => {
    expect(
      statusCounts([
        [leaf("done")],
        [leaf("done", true), leaf("planned")],
        [leaf("in_progress")],
        [],
      ]),
    ).toEqual({
      delivered: 1,
      partially_available: 1,
      in_progress: 1,
      not_started: 1,
    });
  });
});

describe("progress by team", () => {
  const owned = (
    team: string | null,
    status: LeafStatus | null,
    ...children: TeamNode[]
  ): TeamNode => ({ team, status, userVisible: false, children });

  it("counts each team's leaves and how many are done, with unowned work last", () => {
    expect(
      teamProgress([
        owned(
          "Platform",
          null,
          owned("Platform", "done"),
          owned("Platform", "in_progress"),
          owned("Data", "done"),
        ),
        owned(null, "planned"),
        owned("Data", "planned"),
      ]),
    ).toEqual([
      { team: "Data", done: 1, total: 2 },
      { team: "Platform", done: 1, total: 2 },
      { team: null, done: 0, total: 1 },
    ]);
  });

  it("leaves out dropped work, and a team with nothing else", () => {
    expect(
      teamProgress([owned("Web", "dropped"), owned("Data", "done")]),
    ).toEqual([{ team: "Data", done: 1, total: 1 }]);
  });
});
