/** Tests for reading the import form's roadmap: pasted text or an uploaded file, validated at the boundary. */
import { describe, expect, it } from "vitest";

import {
  FILE_TOO_LARGE,
  MAX_ROADMAP_CHARS,
  readRoadmapInput,
} from "./roadmap-input";

function form(fields: { roadmap?: string; file?: File }): FormData {
  const data = new FormData();
  // A browser sends both fields, and React's decoder names the empty file from a blank input "undefined".
  data.set("roadmap", fields.roadmap ?? "");
  data.set("file", fields.file ?? new File([], "undefined"));
  return data;
}

describe("readRoadmapInput", () => {
  it("reads pasted text", async () => {
    expect(await readRoadmapInput(form({ roadmap: "  Plan A\n" }))).toEqual({
      ok: true,
      roadmap: "Plan A",
      source: "a pasted roadmap",
    });
  });

  it("asks for a roadmap when nothing is given", async () => {
    expect(await readRoadmapInput(form({ roadmap: "  " }))).toEqual({
      ok: false,
      message: "Paste a roadmap or choose a file first.",
    });
  });

  it("refuses pasted text over the limit", async () => {
    const result = await readRoadmapInput(
      form({ roadmap: "x".repeat(MAX_ROADMAP_CHARS + 1) }),
    );
    expect(result).toMatchObject({ ok: false });
  });

  it.each([
    "roadmap.md",
    "Roadmap.MARKDOWN",
    "notes.txt",
    "Jira.CSV",
    "page.html",
    "page.htm",
  ])("reads an uploaded %s file and names it as the source", async (name) => {
    const file = new File(["﻿Summary,Issue Type\nExport,Epic\n"], name);
    expect(await readRoadmapInput(form({ file }))).toEqual({
      ok: true,
      roadmap: "Summary,Issue Type\nExport,Epic",
      source: name,
    });
  });

  it.each(["roadmap.xlsx", "roadmap.docx", "roadmap.pdf", "csv"])(
    "refuses a %s file",
    async (name) => {
      const result = await readRoadmapInput(
        form({ file: new File(["data"], name) }),
      );
      expect(result).toMatchObject({ ok: false });
      expect(!result.ok && result.message).toMatch(/not supported/);
    },
  );

  it("refuses a file over the limit, and accepts one at it", async () => {
    const at = new File(["x".repeat(MAX_ROADMAP_CHARS)], "big.csv");
    const over = new File(["x".repeat(MAX_ROADMAP_CHARS + 1)], "big.csv");

    expect(await readRoadmapInput(form({ file: at }))).toMatchObject({
      ok: true,
    });
    expect(await readRoadmapInput(form({ file: over }))).toEqual({
      ok: false,
      message: FILE_TOO_LARGE,
    });
  });

  it("refuses an empty file", async () => {
    expect(
      await readRoadmapInput(form({ file: new File([" \n"], "empty.md") })),
    ).toEqual({ ok: false, message: "That file is empty." });
  });

  it("refuses a file and pasted text together", async () => {
    const result = await readRoadmapInput(
      form({ roadmap: "Plan A", file: new File(["Plan B"], "plan.md") }),
    );
    expect(result).toMatchObject({ ok: false });
    expect(!result.ok && result.message).toMatch(/not both/);
  });
});
