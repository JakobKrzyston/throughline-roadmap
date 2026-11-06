/** Reads and validates the roadmaps submitted on the import page, pasted or as files. Exports readRoadmapInput, readPairedRoadmapInput, their result types, ROADMAP_FILE_TYPES, MAX_ROADMAP_CHARS, MAX_FILE_BYTES, MAX_PAIRED_FILE_BYTES, FILE_TOO_LARGE, PAIRED_FILES_TOO_LARGE, FILE_EMPTY. */
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

/** The error for a file with no text, shared with the form's check for a 0-byte file. */
export const FILE_EMPTY = "That file is empty.";

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
  .refine((text) => text.length > 0, FILE_EMPTY)
  .refine(
    (text) => text.length <= MAX_ROADMAP_CHARS,
    `That file has more than ${MAX_ROADMAP_CHARS.toLocaleString("en")} characters of text, too long to import at once. Export fewer rows or columns, or split it.`,
  );

/**
 * The most two files of a paired import may add up to. Next.js rejects a server action request
 * over 1 MB before the action runs, so this leaves room for the rest of the form.
 */
export const MAX_PAIRED_FILE_BYTES = 900_000;

/** The error for two files over MAX_PAIRED_FILE_BYTES together, shared with the form's own check. */
export const PAIRED_FILES_TOO_LARGE = `Together the two files are over ${MAX_PAIRED_FILE_BYTES / 1000} KB. Export fewer rows or columns from one of them.`;

export type RoadmapInput =
  | { ok: true; roadmap: string; source: string }
  | { ok: false; message: string };

/**
 * Read the roadmap from the import form: the uploaded file if one was chosen, else the pasted text.
 *
 * Args:
 *   formData: Form fields; `file` holds an uploaded file and `roadmap` the pasted text.
 *   prefix: Put before the field names with an underscore, as `product` reads `product_file` and
 *     `product_roadmap`. Empty for the one-roadmap import.
 *
 * Returns:
 *   The roadmap text and a description of where it came from, or a message saying what is wrong.
 */
export async function readRoadmapInput(
  formData: FormData,
  prefix = "",
): Promise<RoadmapInput> {
  const field = (name: string): string => (prefix ? `${prefix}_${name}` : name);
  const file = formData.get(field("file"));
  const pasted = formData.get(field("roadmap"));
  // A blank file input still sends an empty file. The form itself reports a chosen 0-byte file.
  const hasFile = file instanceof File && file.size > 0;

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

export type PairedRoadmapInput =
  | { ok: true; product: string; technical: string }
  | { ok: false; message: string };

/**
 * Read both roadmaps of a paired import, each pasted or uploaded and checked as readRoadmapInput
 * checks one.
 *
 * Args:
 *   formData: Form fields `product_file`, `product_roadmap`, `technical_file` and `technical_roadmap`.
 *
 * Returns:
 *   Both roadmaps' text, or a message saying which one is wrong and how.
 */
export async function readPairedRoadmapInput(
  formData: FormData,
): Promise<PairedRoadmapInput> {
  const fileBytes = ["product_file", "technical_file"]
    .map((name) => formData.get(name))
    .reduce((total, file) => total + (file instanceof File ? file.size : 0), 0);
  if (fileBytes > MAX_PAIRED_FILE_BYTES) {
    return { ok: false, message: PAIRED_FILES_TOO_LARGE };
  }
  const product = await readRoadmapInput(formData, "product");
  if (!product.ok) {
    return { ok: false, message: `Product roadmap: ${product.message}` };
  }
  const technical = await readRoadmapInput(formData, "technical");
  if (!technical.ok) {
    return { ok: false, message: `Technical roadmap: ${technical.message}` };
  }
  return { ok: true, product: product.roadmap, technical: technical.roadmap };
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
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  ndash: "–",
  mdash: "—",
  hellip: "…",
};

/** Elements whose content is never text a reader sees. */
const HIDDEN = new Set([
  "head",
  "script",
  "style",
  "noscript",
  "template",
  "svg",
]);
/** Elements that start or end a line of text. */
const BLOCKS = new Set([
  "p",
  "div",
  "br",
  "ul",
  "ol",
  "table",
  "section",
  "article",
  "blockquote",
  "pre",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);

/**
 * Reduce an exported HTML page to its text, keeping headings, list items, paragraphs and table
 * cells apart so the model still sees the structure.
 *
 * It walks the page once with indexOf instead of using regular expressions such as
 * /<!--[\s\S]*?-->/ or /<[^>]*>/, which rescan to the end of the input from every unclosed "<"
 * and take seconds on a hostile 500 KB file. An unclosed comment, tag or hidden element runs to
 * the end of the input.
 */
function htmlToText(html: string): string {
  // Where a search that found nothing leaves off: the end of the input.
  const after = (found: number, length: number): number =>
    found === -1 ? html.length : found + length;
  let text = "";
  let i = 0;
  while (i < html.length) {
    const open = html.indexOf("<", i);
    if (open === -1) {
      text += html.slice(i);
      break;
    }
    text += html.slice(i, open);
    if (html.startsWith("<!--", open)) {
      i = after(html.indexOf("-->", open + 4), 3);
      continue;
    }
    i = after(html.indexOf(">", open), 1);
    // Lower-cased on its own, since lower-casing can change a string's length and so its indexes.
    const tag = html.slice(open + 1, i - 1).toLowerCase();
    const closing = tag.startsWith("/");
    const opening = !closing && !tag.endsWith("/");
    const name = /^\/?\s*([a-z][a-z0-9]*)/.exec(tag)?.[1] ?? "";
    if (HIDDEN.has(name) && opening) {
      const end = new RegExp(`</${name}`, "gi");
      end.lastIndex = i;
      const found = end.exec(html);
      i = found ? after(html.indexOf(">", found.index), 1) : html.length;
    } else if (/^h[1-6]$/.test(name) && opening) {
      text += `\n${"#".repeat(Number(name[1]))} `;
    } else if (name === "li" && opening) {
      text += "\n- ";
    } else if ((name === "td" || name === "th") && closing) {
      text += " | ";
    } else if (name === "tr" && closing) {
      text += "\n";
    } else if (BLOCKS.has(name)) {
      text += "\n";
    }
  }
  return text
    .replace(
      /&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{1,10});/gi,
      (match, code: string) => {
        if (!code.startsWith("#")) return ENTITIES[code.toLowerCase()] ?? match;
        const point = /^#x/i.test(code)
          ? parseInt(code.slice(2), 16)
          : parseInt(code.slice(1), 10);
        return point > 0 && point <= 0x10ffff
          ? String.fromCodePoint(point)
          : match;
      },
    )
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}
