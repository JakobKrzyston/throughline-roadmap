/** Splits a roadmap into numbered records (P1, T14) that a model cites instead of retyping rows. Exports splitRecords, RoadmapRecords. */

/** One roadmap, split into records with references. */
export type RoadmapRecords = {
  /** The CSV header row, as reference 0. It explains the columns and is never cited. */
  header: { ref: string; text: string } | null;
  /** Every record that must be cited, in order, numbered from 1. */
  records: { ref: string; text: string }[];
};

/**
 * Split a roadmap into records: a CSV into rows, anything else into its non-empty lines.
 *
 * Text counts as CSV when its first row has at least two cells and every other row has the same
 * number, read with a quote-aware splitter so a quoted cell that spans lines stays in its row.
 * Anything else, including a CSV whose rows are ragged, is split into lines, which still gives
 * every part of the text a reference.
 *
 * Args:
 *   text: The roadmap, pasted or uploaded.
 *   prefix: The letter references start with, such as "P" or "T".
 *
 * Returns:
 *   The header (CSV only) and the records. Rows whose cells are all empty are skipped.
 */
export function splitRecords(text: string, prefix: string): RoadmapRecords {
  const normalised = text.replace(/\r\n?/g, "\n");
  const rows = csvRows(normalised).filter((row) =>
    row.cells.some((cell) => cell.trim() !== ""),
  );
  const [header, ...body] = rows;
  const isCsv =
    header !== undefined &&
    header.cells.length >= 2 &&
    body.length > 0 &&
    body.every((row) => row.cells.length === header.cells.length);
  if (isCsv) {
    return {
      header: { ref: `${prefix}0`, text: header.text },
      records: body.map((row, i) => ({
        ref: `${prefix}${i + 1}`,
        text: row.text,
      })),
    };
  }
  const lines = normalised
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    header: null,
    records: lines.map((line, i) => ({ ref: `${prefix}${i + 1}`, text: line })),
  };
}

/**
 * Split CSV text into rows with their cells, in one pass. A quote opens a quoted cell only at the
 * start of a cell, and two quotes inside one stand for a quote, as in RFC 4180. An unclosed quote
 * runs to the end of the text, so the rest stays in one record and is still cited.
 */
function csvRows(text: string): { text: string; cells: string[] }[] {
  const rows: { text: string; cells: string[] }[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char !== '"') cell += char;
      else if (text[i + 1] === '"') cell += text[i++];
      else quoted = false;
    } else if (char === '"' && cell === "") {
      quoted = true;
    } else if (char === ",") {
      cells.push(cell);
      cell = "";
    } else if (char === "\n") {
      cells.push(cell);
      rows.push({ text: text.slice(start, i), cells });
      cells = [];
      cell = "";
      start = i + 1;
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  rows.push({ text: text.slice(start), cells });
  return rows;
}
