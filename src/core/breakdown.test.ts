/** Tests for the technical view's filters in breakdown.ts. */
import { describe, expect, it } from "vitest";

import { type BreakdownNode, filterOptions, visibleKeys } from "./breakdown";

const node = (
  key: string,
  fields: Partial<Omit<BreakdownNode, "key">> = {},
): BreakdownNode => ({
  key,
  workType: null,
  team: null,
  people: [],
  children: [],
  ...fields,
});

// TL-1 (Data, feature) was split into a queue the Data team built and a button the Web team owns.
const roots = [
  node("TL-1", {
    workType: "feature",
    team: "Data",
    children: [
      node("TL-2", {
        workType: "infrastructure",
        team: "Data",
        people: ["maya-chen"],
      }),
      node("TL-5", { workType: "feature", team: "Web", people: ["leo"] }),
    ],
  }),
  node("TL-6", { workType: "security", team: "Data" }),
];

describe("visibleKeys", () => {
  it("shows a match together with the requirements it was split from", () => {
    expect(visibleKeys(roots, { person: "leo" })).toEqual(
      new Set(["TL-1", "TL-5"]),
    );
    expect(visibleKeys(roots, { workType: "infrastructure" })).toEqual(
      new Set(["TL-1", "TL-2"]),
    );
  });

  it("shows a matching parent without its children that do not match", () => {
    expect(visibleKeys(roots, { workType: "feature" })).toEqual(
      new Set(["TL-1", "TL-5"]),
    );
  });

  it("needs every filter that is set to match", () => {
    expect(visibleKeys(roots, { team: "Data" })).toEqual(
      new Set(["TL-1", "TL-2", "TL-6"]),
    );
    expect(visibleKeys(roots, { team: "Data", person: "leo" })).toEqual(
      new Set(),
    );
  });

  it("shows everything for an empty filter", () => {
    expect(visibleKeys(roots, {}).size).toBe(4);
  });
});

describe("filterOptions", () => {
  it("sorts teams the way the rollup by team does, ignoring case", () => {
    expect(
      filterOptions([
        {
          requirements: [
            node("TL-1", { team: "Web" }),
            node("TL-2", { team: "data" }),
          ],
        },
      ]).teams,
    ).toEqual(["data", "Web"]);
  });

  it("lists each team and person once, sorted", () => {
    expect(
      filterOptions([{ requirements: roots }, { requirements: [] }]),
    ).toEqual({
      workTypes: ["feature", "infrastructure", "security"],
      teams: ["Data", "Web"],
      people: ["leo", "maya-chen"],
    });
  });

  it("offers nothing to choose from a roadmap without kinds, teams or people", () => {
    expect(filterOptions([{ requirements: [node("TL-1")] }])).toEqual({
      workTypes: [],
      teams: [],
      people: [],
    });
  });
});
