/** Reads and validates the roadmap submitted on the import page, pasted or as a file. Exports readRoadmapInput, RoadmapInput, ROADMAP_FILE_TYPES, MAX_ROADMAP_CHARS, MAX_FILE_BYTES, FILE_TOO_LARGE. */
import { z } from "zod";

/** File extensions the import page accepts. All are plain text, so no parser is needed. */
export const ROADMAP_FILE_TYPES = [
  ".md",
  ".markdown",
  ".txt",
  ".csv",
  ".html",
  ".htm",
];

/** The most text one import sends to the model, pasted or uploaded. */
export const MAX_ROADMAP_CHARS = 50_000;

/**
 * The largest file accepted. It is above MAX_ROADMAP_CHARS because HTML shrinks once its markup
 * is removed, and well under the 1 MB Next.js allows a server action's request.
 */
export const MAX_FILE_BYTES = 500_000;

/** The error for a file over MAX_FILE_BYTES, shared with the form's own check. */
export const FILE_TOO_LARGE = `That file is over ${MAX_FILE_BYTES / 1000} KB. Export fewer rows or columns, or split it.`;

const pastedSchema = z
  .string({ error: "Paste a roadmap or choose a file first." })
  .trim()
  .min(1, "Paste a roadmap or choose a file first.")
  .max(
    MAX_ROADMAP_CHARS,
    "That is too long to import at once. Paste one section at a time.",
  );

const fileSchema = z
  .instanceof(File)
  .refine(
    (file) =>
      ROADMAP_FILE_TYPES.some((type) => file.name.toLowerCase().endsWith(type)),
    `That file type is not supported. Choose a ${ROADMAP_FILE_TYPES.join(", ")} file; most tools can export CSV or Markdown.`,
  )
  .refine((file) => file.size <= MAX_FILE_BYTES, FILE_TOO_LARGE);

const fileTextSchema = z
  .string()
  .refine(
    (text) => !text.includes("\u0000"),
    "That file does not look like text. Export it as CSV, Markdown or plain text.",
  )
  .transform((text) => text.trim())
  .refine((text) => text.length > 0, "That file is empty.")
  .refine(
    (text) => text.length <= MAX_ROADMAP_CHARS,
    `That file has more than ${MAX_ROADMAP_CHARS.toLocaleString("en")} characters of text, too long to import at once. Export fewer rows or columns, or split it.`,
  );

export type RoadmapInput =
  | { ok: true; roadmap: string; source: string }
  | { ok: false; message: string };

/**
 * Read the roadmap from the import form: the uploaded file if one was chosen, else the pasted text.
 *
 * Args:
 *   formData: Form fields; `file` holds an uploaded file and `roadmap` the pasted text.
 *
 * Returns:
 *   The roadmap text and a description of where it came from, or a message saying what is wrong.
 */
export async function readRoadmapInput(
  formData: FormData,
): Promise<RoadmapInput> {
  const file = formData.get("file");
  const pasted = formData.get("roadmap");
  // A blank file input sends an empty file named "" (plain form post) or "undefined" (React's decoder).
  const hasFile =
    file instanceof File &&
    (file.size > 0 || (file.name !== "" && file.name !== "undefined"));

  if (!hasFile) {
    const roadmap = pastedSchema.safeParse(pasted);
    return roadmap.success
      ? { ok: true, roadmap: roadmap.data, source: "a pasted roadmap" }
      : { ok: false, message: roadmap.error.issues[0].message };
  }
  if (typeof pasted === "string" && pasted.trim()) {
    return {
      ok: false,
      message:
        "Choose a file or paste a roadmap, not both. Your pasted text is still here: import it as it is, or clear it and choose the file again.",
    };
  }

  const valid = fileSchema.safeParse(file);
  if (!valid.success) {
    return { ok: false, message: valid.error.issues[0].message };
  }
  const decoded = decode(new Uint8Array(await valid.data.arrayBuffer()));
  const isHtml = /\.html?$/i.test(valid.data.name);
  const text = fileTextSchema.safeParse(isHtml ? htmlToText(decoded) : decoded);
  if (!text.success)
    return { ok: false, message: text.error.issues[0].message };
  // The file's name is not shown: on a shared demo, other visitors would read whatever it says.
  return { ok: true, roadmap: text.data, source: "an uploaded file" };
}

/**
 * Decode a text file: UTF-16 when it starts with that byte order mark, else UTF-8, else
 * Windows-1252, the encoding Excel on Windows uses for "CSV" that is not UTF-8.
 */
function decode(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes);
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/**
 * Reduce an exported HTML page to its text, keeping headings, list items, paragraphs and table
 * cells apart so the model still sees the structure.
 */
function htmlToText(html: string): string {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(
      /<(head|script|style|noscript|template|svg)\b[\s\S]*?<\/\1\s*>/gi,
      "",
    )
    .replace(/<h([1-6])\b[^>]*>/gi, (_, level: string) => {
      return `\n${"#".repeat(Number(level))} `;
    })
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/t[dh]\s*>/gi, " | ")
    .replace(/<\/tr\s*>/gi, "\n")
    .replace(
      /<\/?(p|div|br|ul|ol|table|section|article|blockquote|pre|h[1-6])\b[^>]*>/gi,
      "\n",
    )
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
      if (!code.startsWith("#")) return ENTITIES[code.toLowerCase()] ?? match;
      const point = /^#x/i.test(code)
        ? parseInt(code.slice(2), 16)
        : parseInt(code.slice(1), 10);
      return point > 0 && point <= 0x10ffff
        ? String.fromCodePoint(point)
        : match;
    });
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}
