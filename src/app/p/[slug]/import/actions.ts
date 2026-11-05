"use server";
/** Server action behind the import page. Exports generateImportProposal and its state type. */
import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { getDemoLLMProvider, getLLMProvider } from "@/adapters/llm";
import { LLMOutputError } from "@/adapters/llm/provider";
import { DEMO_LLM_FIXTURES } from "@/agents/fixtures";
import { runImport } from "@/agents/import";
import { getDb } from "@/db/client";
import { projects } from "@/db/schema";
import { isPublicDeployment, isViewOnly } from "@/lib/public-deployment";

export type ImportState =
  | { status: "idle" }
  // The pasted text comes back so the form can restore it; React clears form fields after an action.
  | { status: "error"; message: string; roadmap: string }
  | { status: "success"; summary: string; reviewHref: string };

const roadmapSchema = z
  .string({ error: "Paste a roadmap first." })
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
  const raw = formData.get("roadmap");
  const fail = (message: string): ImportState => ({
    status: "error",
    message,
    roadmap: typeof raw === "string" ? raw : "",
  });

  const roadmap = roadmapSchema.safeParse(raw);
  if (!roadmap.success) return fail(roadmap.error.issues[0].message);

  const db = getDb();
  const [project] = await db
    .select({ id: projects.id, isDemo: projects.isDemo })
    .from(projects)
    .where(eq(projects.slug, slug));
  if (!project) return fail("Project not found.");
  if (isViewOnly(project)) {
    return fail("This project is view-only on this server.");
  }

  try {
    const { proposalId, summary } = await runImport(
      db,
      // Visitors to a public server only reach demo projects here, and must not spend the Anthropic key.
      isPublicDeployment()
        ? getDemoLLMProvider(DEMO_LLM_FIXTURES)
        : getLLMProvider(DEMO_LLM_FIXTURES),
      project.id,
      roadmap.data,
    );
    // The new proposal adds one to the review queue count in the top bar.
    refresh();
    return {
      status: "success",
      summary,
      reviewHref: `/p/${slug}/review#proposal-${proposalId}`,
    };
  } catch (error) {
    if (error instanceof LLMOutputError) return fail(error.message);
    console.error("Roadmap import failed:", error);
    return fail(
      "Something went wrong while generating the proposal, so nothing was saved. Please try again.",
    );
  }
}
