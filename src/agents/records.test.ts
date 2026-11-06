/** Tests for splitting a roadmap into referenced records. */
import { describe, expect, it } from "vitest";

import { PAIRED_SAMPLE } from "./import-samples";
import { splitRecords } from "./records";

describe("splitRecords", () => {
  it("gives a CSV row with a quoted cell spanning several lines one reference", () => {
    const csv =
      'Key,Summary,Description\nT-1,Worker,"Sends email.\nRetries, with backoff.\nRecords ""every"" send."\nT-2,Page,Shows usage\n';

    expect(splitRecords(csv, "T")).toEqual({
      header: { ref: "T0", text: "Key,Summary,Description" },
      records: [
        {
          ref: "T1",
          text: 'T-1,Worker,"Sends email.\nRetries, with backoff.\nRecords ""every"" send."',
        },
        { ref: "T2", text: "T-2,Page,Shows usage" },
      ],
    });
  });

  it("numbers the paired sample's technical CSV one reference per row", () => {
    const { records } = splitRecords(PAIRED_SAMPLE.technical, "T");

    expect(records).toHaveLength(11);
    expect(records[1].text).toMatch(/^PLAT-202,.*\n.*\nRecords every delivery/);
  });

  it("splits Markdown and plain text into non-empty lines", () => {
    expect(
      splitRecords("# Plan\n\n- Mobile app\r\n  - Login  \n", "P"),
    ).toEqual({
      header: null,
      records: [
        { ref: "P1", text: "# Plan" },
        { ref: "P2", text: "- Mobile app" },
        { ref: "P3", text: "- Login" },
      ],
    });
  });

  it("skips empty rows and reads CRLF line breaks in a CSV", () => {
    expect(splitRecords("A,B\r\n1,2\r\n,\r\n\r\n3,4\r\n", "P").records).toEqual(
      [
        { ref: "P1", text: "1,2" },
        { ref: "P2", text: "3,4" },
      ],
    );
  });

  it("falls back to lines when rows are ragged, so every part still has a reference", () => {
    expect(splitRecords("A,B\n1,2,3\n4,5", "P")).toEqual({
      header: null,
      records: [
        { ref: "P1", text: "A,B" },
        { ref: "P2", text: "1,2,3" },
        { ref: "P3", text: "4,5" },
      ],
    });
  });

  it("keeps the rest of the text in one record after an unclosed quote", () => {
    expect(splitRecords('A,B\n1,"2\n3,4', "P").records).toEqual([
      { ref: "P1", text: '1,"2\n3,4' },
    ]);
  });

  it("treats a quote inside an unquoted cell as text", () => {
    expect(
      splitRecords('Item,Size\nScreen,5" wide\nCase,Small', "P").records,
    ).toHaveLength(2);
  });
});
