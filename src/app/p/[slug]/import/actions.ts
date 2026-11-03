"use server";
/** Server action behind the import page. Exports generateImportProposal and its state type. */
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getLLMProvider } from "@/adapters/llm";
import { LLMOutputError } from "@/adapters/llm/provider";
import { runImport } from "@/agents/import";
import { getDb } from "@/db/client";
import { projects } from "@/db/schema";

export type ImportState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success"; summary: string; reviewHref: string };

const roadmapSchema = z
  .string()
  .trim()
  .min(1, "Paste a roadmap first.")
  .max(
    50_000,
    "That is too long to import at once. Paste one section at a time.",
  );

/**
 * Run the import agent on the pasted roadmap and save the result as a pending proposal.
 *
 * Args:
 *   slug: The project's slug, bound by the page.
 *   _previous: The form's previous state (unused; required by useActionState).
 *   formData: Form fields; `roadmap` holds the pasted text.
 *
 * Returns:
 *   A success state with a link to the review queue, or an error message to show.
 */
export async function generateImportProposal(
  slug: string,
  _previous: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const roadmap = roadmapSchema.safeParse(formData.get("roadmap"));
  if (!roadmap.success) {
    return { status: "error", message: roadmap.error.issues[0].message };
  }

  const db = getDb();
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, slug));
  if (!project) return { status: "error", message: "Project not found." };

  try {
    const { proposalId, summary } = await runImport(
      db,
      getLLMProvider(),
      project.id,
      roadmap.data,
    );
    return {
      status: "success",
      summary,
      reviewHref: `/p/${slug}/review#proposal-${proposalId}`,
    };
  } catch (error) {
    if (error instanceof LLMOutputError) {
      return { status: "error", message: error.message };
    }
    console.error("Roadmap import failed:", error);
    return {
      status: "error",
      message:
        "Something went wrong while generating the proposal, so nothing was saved. Please try again.",
    };
  }
}
