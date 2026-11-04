/** Tests for target validation, formatting, comparison and late-work checks in schedule.ts. */
import { describe, expect, it } from "vitest";

import type { LeafStatus } from "./operations";
import {
  describeTargetMove,
  formatTarget,
  hasOpenWork,
  isLater,
  lateRequirements,
  type ScheduledRequirement,
  scheduleWarnings,
  targetEnd,
  targetSchema,
} from "./schedule";

const leaf = (
  key: string,
  status: LeafStatus,
  target: string | null = null,
): ScheduledRequirement => ({
  key,
  title: key,
  target,
  status,
  userVisible: false,
  children: [],
});

const parent = (
  key: string,
  target: string | null,
  ...children: ScheduledRequirement[]
): ScheduledRequirement => ({
  key,
  title: key,
  target,
  status: null,
  userVisible: false,
  children,
});

describe("targetSchema", () => {
  it.each(["2027-Q1", "2027-Q4", "2027-01-11", "2028-02-29"])(
    "accepts %j",
    (target) => {
      expect(targetSchema.safeParse(target).success).toBe(true);
    },
  );

  it.each(["2027-Q5", "Q1 2027", "2027-02-30", "2027-1-11", "soon", ""])(
    "rejects %j",
    (target) => {
      expect(targetSchema.safeParse(target).success).toBe(false);
    },
  );
});

describe("formatTarget", () => {
  it("writes quarters and dates for reading", () => {
    expect(formatTarget("2026-Q4")).toBe("Q4 2026");
    expect(formatTarget("2027-01-11")).toBe("11 January 2027");
  });

  it("shows anything else as it is", () => {
    expect(formatTarget("next spring")).toBe("next spring");
  });
});

describe("targetEnd and isLater", () => {
  it("ends a quarter on its last day", () => {
    expect(targetEnd("2027-Q1")).toBe("2027-03-31");
    expect(targetEnd("2027-Q4")).toBe("2027-12-31");
    expect(targetEnd("2027-01-11")).toBe("2027-01-11");
  });

  it("compares quarters with dates by their last day", () => {
    expect(isLater("2027-Q2", "2027-Q1")).toBe(true);
    expect(isLater("2027-04-01", "2027-Q1")).toBe(true);
    expect(isLater("2027-03-31", "2027-Q1")).toBe(false);
    expect(isLater("2027-Q1", "2027-02-01")).toBe(true);
    expect(isLater("2027-Q1", "2027-Q1")).toBe(false);
  });
});

describe("hasOpenWork", () => {
  it("is true while any leaf is planned or in progress", () => {
    expect(hasOpenWork([leaf("TL-1", "done"), leaf("TL-2", "planned")])).toBe(
      true,
    );
    expect(
      hasOpenWork([parent("TL-1", null, leaf("TL-2", "in_progress"))]),
    ).toBe(true);
  });

  it("is false when everything is done or dropped", () => {
    expect(hasOpenWork([leaf("TL-1", "done"), leaf("TL-2", "dropped")])).toBe(
      false,
    );
    expect(hasOpenWork([])).toBe(false);
  });
});

describe("lateRequirements", () => {
  it("lists unfinished work due after the outcome's target", () => {
    const roots = [
      leaf("TL-1", "planned", "2027-Q2"),
      leaf("TL-2", "planned", "2027-Q1"),
      leaf("TL-3", "planned"),
    ];
    expect(lateRequirements("2027-Q1", roots).map((r) => r.key)).toEqual([
      "TL-1",
    ]);
  });

  it("ignores finished and dropped work, however late its target", () => {
    const roots = [
      leaf("TL-1", "done", "2027-Q3"),
      leaf("TL-2", "dropped", "2027-Q3"),
      parent("TL-3", "2027-Q3", leaf("TL-4", "done")),
    ];
    expect(lateRequirements("2027-Q1", roots)).toEqual([]);
  });

  it("checks children as well as parents", () => {
    const roots = [
      parent(
        "TL-1",
        "2027-Q3",
        leaf("TL-2", "in_progress", "2027-Q4"),
        leaf("TL-3", "planned", "2027-Q1"),
      ),
    ];
    expect(lateRequirements("2027-Q2", roots).map((r) => r.key)).toEqual([
      "TL-1",
      "TL-2",
    ]);
  });

  it("cannot compare a target saved before targets were validated", () => {
    expect(
      lateRequirements("H1 2027", [leaf("TL-1", "planned", "2027-Q3")]),
    ).toEqual([]);
    expect(
      lateRequirements("2027-Q1", [leaf("TL-1", "planned", "H2 2027")]),
    ).toEqual([]);
    expect(
      scheduleWarnings("H1 2027", [leaf("TL-1", "planned")], "2030-01-01")
        .passed,
    ).toBe(false);
  });

  it("finds nothing when the outcome has no target", () => {
    expect(
      lateRequirements(null, [leaf("TL-1", "planned", "2027-Q3")]),
    ).toEqual([]);
  });
});

describe("describeTargetMove", () => {
  it.each([
    ["2027-Q1", "2027-Q2", "Moved from Q1 2027 to Q2 2027."],
    [null, "2027-03-31", "Now planned for 31 March 2027."],
    ["2027-Q1", null, "The target date was removed."],
    ["2027-Q1", "2027-Q1", null],
  ])("describes %j to %j", (before, after, note) => {
    expect(describeTargetMove(before, after)).toBe(note);
  });
});

describe("scheduleWarnings", () => {
  const roots = [leaf("TL-1", "planned", "2027-Q2"), leaf("TL-2", "done")];

  it("reports late work and a passed target", () => {
    expect(scheduleWarnings("2027-Q1", roots, "2027-04-01")).toMatchObject({
      late: [{ key: "TL-1" }],
      passed: true,
    });
  });

  it("does not count a target as passed on its last day, or with nothing open", () => {
    expect(scheduleWarnings("2027-Q1", roots, "2027-03-31").passed).toBe(false);
    expect(
      scheduleWarnings("2027-Q1", [leaf("TL-2", "done")], "2027-06-01"),
    ).toEqual({ late: [], passed: false });
    expect(scheduleWarnings(null, roots, "2027-06-01")).toEqual({
      late: [],
      passed: false,
    });
  });
});
