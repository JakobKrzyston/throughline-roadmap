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

  it("reads a list with an Oxford comma or an ampersand", () => {
    expect(parseReferences("Part of TL-3, TL-4, and TL-5 & TL-6")).toEqual([
      { key: "TL-3", relation: "part_of" },
      { key: "TL-4", relation: "part_of" },
      { key: "TL-5", relation: "part_of" },
      { key: "TL-6", relation: "part_of" },
    ]);
  });

  it("accepts a colon after the phrase and extra spaces inside it", () => {
    expect(parseReferences("Implements: TL-3\nPart  of TL-4")).toEqual([
      { key: "TL-3", relation: "implements" },
      { key: "TL-4", relation: "part_of" },
    ]);
  });

  it("does not shorten a dotted key to its prefix", () => {
    expect(parseReferences("Implements TL-3.1")).toEqual([]);
    expect(parseReferences("Implements TL-3.")).toEqual([
      { key: "TL-3", relation: "implements" },
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

  it("ignores references quoted in inline code", () => {
    expect(
      parseReferences("- [ ] Merging a PR with `Implements TL-4` works"),
    ).toEqual([]);
    expect(parseReferences("Write ``Part of TL-4`` in the body")).toEqual([]);
  });

  it("ignores references inside fenced code blocks", () => {
    const body = [
      "Example:",
      "```md",
      "Implements TL-4",
      "```",
      "~~~",
      "Part of TL-5",
      "~~~",
      "Implements TL-6",
    ].join("\n");
    expect(parseReferences(body)).toEqual([
      { key: "TL-6", relation: "implements" },
    ]);
  });

  it("ignores an unclosed fenced block to the end of the text", () => {
    expect(parseReferences("Implements TL-1\n```\nImplements TL-2")).toEqual([
      { key: "TL-1", relation: "implements" },
    ]);
  });

  it("still finds references in prose next to code", () => {
    expect(
      parseReferences("Implements TL-4. Run `pnpm test` and see `TL-9`."),
    ).toEqual([{ key: "TL-4", relation: "implements" }]);
  });

  it("treats an unmatched backtick as plain text", () => {
    expect(parseReferences("It's a ` stray. Implements TL-4")).toEqual([
      { key: "TL-4", relation: "implements" },
    ]);
  });
});
