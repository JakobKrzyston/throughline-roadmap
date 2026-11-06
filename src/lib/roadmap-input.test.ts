/** Tests for reading the import form's roadmap: pasted text or an uploaded file, validated at the boundary. */
import { describe, expect, it } from "vitest";

import {
  FILE_EMPTY,
  FILE_TOO_LARGE,
  MAX_FILE_BYTES,
  MAX_ROADMAP_CHARS,
  readRoadmapInput,
  type RoadmapInput,
} from "./roadmap-input";

// A blank file input still sends an empty file; through React's decoder it is named "undefined".
const NO_FILE = new File([], "undefined");

function form(fields: { roadmap?: string; file?: File }): FormData {
  const data = new FormData();
  // A browser sends both fields.
  data.set("roadmap", fields.roadmap ?? "");
  data.set("file", fields.file ?? NO_FILE);
  return data;
}

async function upload(
  content: BlobPart,
  name = "roadmap.csv",
): Promise<RoadmapInput> {
  return readRoadmapInput(form({ file: new File([content], name) }));
}

function message(result: RoadmapInput): string {
  return result.ok ? "" : result.message;
}

describe("readRoadmapInput", () => {
  it("reads pasted text", async () => {
    expect(await readRoadmapInput(form({ roadmap: "  Plan A\n" }))).toEqual({
      ok: true,
      roadmap: "Plan A",
      source: "a pasted roadmap",
    });
  });

  it.each([
    ["React's decoder", NO_FILE],
    ["a plain form post", new File([], "")],
  ])("reads pasted text beside a blank file input from %s", async (_, file) => {
    expect(
      await readRoadmapInput(form({ roadmap: "Plan A", file })),
    ).toMatchObject({ ok: true, roadmap: "Plan A" });
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

  it.each(["roadmap.md", "Roadmap.MARKDOWN", "notes.txt", "Jira.CSV"])(
    "reads an uploaded %s file without naming it",
    async (name) => {
      expect(await upload("﻿Summary,Issue Type\nExport,Epic\n", name)).toEqual({
        ok: true,
        roadmap: "Summary,Issue Type\nExport,Epic",
        // A shared demo would show other visitors whatever the name says.
        source: "an uploaded file",
      });
    },
  );

  it.each(["roadmap.xlsx", "roadmap.docx", "roadmap.pdf", "csv"])(
    "refuses a %s file",
    async (name) => {
      expect(message(await upload("data", name))).toMatch(/not supported/);
    },
  );

  it("refuses a file over the byte limit", async () => {
    expect(await upload("x".repeat(MAX_FILE_BYTES + 1))).toEqual({
      ok: false,
      message: FILE_TOO_LARGE,
    });
  });

  it("refuses a file with more text than one import takes, and accepts one at the limit", async () => {
    expect(await upload("x".repeat(MAX_ROADMAP_CHARS))).toMatchObject({
      ok: true,
    });
    expect(message(await upload("x".repeat(MAX_ROADMAP_CHARS + 1)))).toMatch(
      /more than 50,000 characters/,
    );
  });

  it("refuses a file with only whitespace", async () => {
    expect(await upload(" \n", "empty.md")).toEqual({
      ok: false,
      message: FILE_EMPTY,
    });
  });

  // Indistinguishable from a blank file input, so the form reports a chosen 0-byte file instead.
  it("treats a 0-byte file as no file", async () => {
    expect(await upload("", "empty.md")).toEqual({
      ok: false,
      message: "Paste a roadmap or choose a file first.",
    });
  });

  it("refuses a file and pasted text together", async () => {
    const result = await readRoadmapInput(
      form({ roadmap: "Plan A", file: new File(["Plan B"], "plan.md") }),
    );
    expect(message(result)).toMatch(/not both/);
  });

  describe("text encodings", () => {
    const text = "Café rollout – Q1 “launch”";

    it("reads UTF-16 with a byte order mark", async () => {
      const le = new Uint8Array([0xff, 0xfe, ...utf16(text, true)]);
      const be = new Uint8Array([0xfe, 0xff, ...utf16(text, false)]);
      expect(await upload(le)).toMatchObject({ roadmap: text });
      expect(await upload(be)).toMatchObject({ roadmap: text });
    });

    it("reads Windows-1252, as Excel saves CSV", async () => {
      // "Café rollout – Q1 “launch”" in Windows-1252.
      const bytes = new Uint8Array([
        ...ascii("Caf"),
        0xe9,
        ...ascii(" rollout "),
        0x96,
        ...ascii(" Q1 "),
        0x93,
        ...ascii("launch"),
        0x94,
      ]);
      expect(await upload(bytes)).toMatchObject({ roadmap: text });
    });

    it("refuses binary data", async () => {
      const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
      expect(message(await upload(bytes))).toMatch(/does not look like text/);
    });
  });

  describe("HTML files", () => {
    it("are reduced to their text, keeping the structure", async () => {
      const html = `<!doctype html><html><head><title>Roadmap</title>
        <style>.x { color: red }</style><script>alert("hi")</script></head>
        <body><!-- exported by Confluence --><h1 class="title">2027 roadmap</h1>
        <p>Teams asked for <strong>scheduled</strong>&nbsp;reports &amp; alerts.</p>
        <ul><li>Email delivery</li><li>Slack delivery &#8211; maybe</li></ul>
        <table><tr><th>Item</th><th>When</th></tr><tr><td>PDF export</td><td>Q2</td></tr></table>
        </body></html>`;

      expect(await upload(html, "roadmap.html")).toMatchObject({
        ok: true,
        roadmap: [
          "# 2027 roadmap",
          "",
          "Teams asked for scheduled reports & alerts.",
          "",
          "- Email delivery",
          "- Slack delivery – maybe",
          "",
          "Item | When |",
          "PDF export | Q2 |",
        ].join("\n"),
      });
    });

    it("decode typographic and numeric entities", async () => {
      const html =
        "<p>&ldquo;Ship it&rdquo; &ndash; it&rsquo;s &lsquo;done&rsquo; &mdash; nearly&hellip; &#8364;5 &#x2192; &#x1F680; &bogus;</p>";
      expect(await upload(html, "page.html")).toMatchObject({
        roadmap: "“Ship it” – it’s ‘done’ — nearly… €5 → 🚀 &bogus;",
      });
    });

    it("keep the page after a self-closing hidden element, and drop an unclosed one to the end", async () => {
      expect(
        await upload("<svg/><p>Plan A</p><script>x", "page.html"),
      ).toMatchObject({ roadmap: "Plan A" });
    });

    // A 500 KB file of each pattern; regular expressions like /<!--[\s\S]*?-->/ take seconds.
    it.each(["<!--", "<script", "<h1", "<", "<li", "&#1"])(
      "are reduced in linear time when %j repeats with nothing closing it",
      async (pattern) => {
        const html = pattern.repeat(
          Math.floor(MAX_FILE_BYTES / pattern.length),
        );
        const started = performance.now();
        await upload(html, "page.html");
        expect(performance.now() - started).toBeLessThan(500);
      },
    );

    it("are measured after the markup is removed", async () => {
      const padding = `<div style="${"x".repeat(MAX_ROADMAP_CHARS)}">`;
      expect(await upload(`${padding}Plan A</div>`, "page.htm")).toMatchObject({
        ok: true,
        roadmap: "Plan A",
      });
    });
  });
});

function ascii(text: string): number[] {
  return [...text].map((char) => char.charCodeAt(0));
}

function utf16(text: string, littleEndian: boolean): number[] {
  return [...text].flatMap((char) => {
    const code = char.charCodeAt(0);
    return littleEndian ? [code & 0xff, code >> 8] : [code >> 8, code & 0xff];
  });
}
