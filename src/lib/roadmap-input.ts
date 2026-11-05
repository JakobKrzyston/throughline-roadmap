/** Reads and validates the roadmap submitted on the import page, pasted or as a file. Exports readRoadmapInput, RoadmapInput, ROADMAP_FILE_TYPES, MAX_ROADMAP_CHARS, FILE_TOO_LARGE. */
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

/** The error for a file over MAX_ROADMAP_CHARS bytes, shared with the form's own check. */
export const FILE_TOO_LARGE = `That file is over ${MAX_ROADMAP_CHARS / 1000} KB, too long to import at once. Export fewer rows or columns, or split it.`;

const pastedSchema = z
  .string({ error: "Paste a roadmap or choose a file first." })
  .trim()
  .min(1, "Paste a roadmap or choose a file first.")
  .max(
    MAX_ROADMAP_CHARS,
    "That is too long to import at once. Paste one section at a time.",
  );

// One byte is at most one character, so a file within the limit always fits the text limit.
const fileSchema = z
  .instanceof(File)
  .refine(
    (file) =>
      ROADMAP_FILE_TYPES.some((type) => file.name.toLowerCase().endsWith(type)),
    `That file type is not supported. Choose a ${ROADMAP_FILE_TYPES.join(", ")} file; most tools can export CSV or Markdown.`,
  )
  .refine((file) => file.size <= MAX_ROADMAP_CHARS, FILE_TOO_LARGE);

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
  // A blank file input still sends an empty file, which reaches the server named "undefined".
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
        "Choose a file or paste a roadmap, not both. Clear the text box to import the file.",
    };
  }

  const valid = fileSchema.safeParse(file);
  if (!valid.success) {
    return { ok: false, message: valid.error.issues[0].message };
  }
  const roadmap = (await valid.data.text()).trim();
  if (!roadmap) return { ok: false, message: "That file is empty." };
  return { ok: true, roadmap, source: valid.data.name };
}
