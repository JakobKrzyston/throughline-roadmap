/** Tests for parseReferences. */
import { describe, expect, it } from "vitest";

import { parseReferences } from "./references";

describe("parseReferences", () => {
  it("finds both phrases", () => {
    expect(parseReferences("Implements TL-12")).toEqual([
      { key: "TL-12", relation: "implements" },
    ]);
    expect(parseReferences("Part of TL-3")).toEqual([
      { key: "TL-3", relation: "part_of" },
    ]);
  });

  it("finds several references in one PR", () => {
    const body = [
      "Adds the CSV writer.",
      "",
      "Implements TL-3",
      "Part of TL-2, TL-5 and TL-9",
    ].join("\n");
    expect(parseReferences(body)).toEqual([
      { key: "TL-3", relation: "implements" },
      { key: "TL-2", relation: "part_of" },
      { key: "TL-5", relation: "part_of" },
      { key: "TL-9", relation: "part_of" },
    ]);
  });

  it("accepts lowercase phrases and keys and upper-cases the key", () => {
    expect(parseReferences("this implements tl-12; PART OF Tl-4")).toEqual([
      { key: "TL-12", relation: "implements" },
      { key: "TL-4", relation: "part_of" },
    ]);
  });

  it("reports one reference per key and prefers implements", () => {
    expect(
      parseReferences("Part of TL-1. Implements TL-1. Part of TL-1."),
    ).toEqual([{ key: "TL-1", relation: "implements" }]);
  });

  it("ignores keys without a linking phrase", () => {
    expect(parseReferences("Follow-up to TL-12, see TL-13")).toEqual([]);
  });

  it("ignores phrases that are not followed by a key", () => {
    expect(
      parseReferences("This implements the spec. Part of the TL-12 work."),
    ).toEqual([]);
  });

  it("does not match inside longer words or keys", () => {
    expect(parseReferences("reimplements TL-1, Implements TL-2x")).toEqual([]);
  });

  it("returns keys whether or not they exist; the caller checks that", () => {
    expect(parseReferences("Implements NOPE-999")).toEqual([
      { key: "NOPE-999", relation: "implements" },
    ]);
  });
});
