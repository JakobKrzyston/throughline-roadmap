"use server";
/** Server actions behind the import page. Exports generateImportProposal, generatePairedImportProposal, their state types, loadImportSample and loadPairedSample. */
import { eq } from "drizzle-orm";
import { refresh } from "next/cache";

import {
  demoModels,
  getDemoLLMProvider,
  getLLMProvider,
  isDemoLLM,
} from "@/adapters/llm";
import { LLMOutputError } from "@/adapters/llm/provider";
import { runImport } from "@/agents/import";
import {
  IMPORT_SAMPLES,
  importFixturesFor,
  isPairedSample,
  PAIRED_SAMPLE,
  pairedImportFixturesFor,
} from "@/agents/import-samples";
import { runPairedImport } from "@/agents/paired-import";
import { getDb } from "@/db/client";
import { projects } from "@/db/schema";
import { isPublicDeployment, isViewOnly } from "@/lib/public-deployment";
import { readPairedRoadmapInput, readRoadmapInput } from "@/lib/roadmap-input";

export type ImportState =
  | { status: "idle" }
  // The pasted text comes back so the form can restore it; React clears form fields after an action.
  | { status: "error"; message: string; roadmap: string }
  | { status: "success"; summary: string; reviewHref: string };

/**
 * Run the import agent on the pasted or uploaded roadmap and save the result as a pending proposal.
 *
 * Args:
 *   slug: The project's slug, bound by the page.
 *   _previous: The form's previous state (unused; required by useActionState).
 *   formData: Form fields; `roadmap` holds pasted text and `file` an uploaded file.
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

  const db = getDb();
  const [project] = await db
    .select({ id: projects.id, isDemo: projects.isDemo })
    .from(projects)
    .where(eq(projects.slug, slug));
  if (!project) return fail("Project not found.");
  if (isViewOnly(project)) {
    return fail("This project is view-only on this server.");
  }
  // Read and decode the file only once the project may be changed.
  const input = await readRoadmapInput(formData);
  if (!input.ok) return fail(input.message);

  // Without a model, a sample export gets the proposal written for it.
  const demoFixtures = importFixturesFor(input.roadmap);
  try {
    const { proposalId, summary } = await runImport(
      db,
      // Visitors to a public server only reach demo projects here, and must not spend the Anthropic key.
      isPublicDeployment()
        ? getDemoLLMProvider(demoFixtures)
        : getLLMProvider(demoFixtures),
      project.id,
      input.roadmap,
      input.source,
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

/**
 * Return one sample export's text, so the page only sends a sample when someone asks for it.
 *
 * Args:
 *   id: The sample's id, from the button that was clicked.
 *
 * Returns:
 *   The sample's text, or an empty string for an unknown id.
 */
export async function loadImportSample(id: string): Promise<string> {
  return IMPORT_SAMPLES.find((sample) => sample.id === id)?.content ?? "";
}

export type PairedImportState =
  | { status: "idle" }
  // Both pasted texts come back so the form can restore them, as for the one-roadmap import.
  | { status: "error"; message: string; product: string; technical: string }
  | { status: "success"; summary: string; reviewHref: string };

/**
 * Run the paired import agent on a product roadmap and a technical roadmap, and save the result
 * as one pending proposal.
 *
 * Args:
 *   slug: The project's slug, bound by the page.
 *   _previous: The form's previous state (unused; required by useActionState).
 *   formData: `product_roadmap` or `product_file`, and `technical_roadmap` or `technical_file`.
 *
 * Returns:
 *   A success state with a link to the review queue, or an error message to show.
 */
export async function generatePairedImportProposal(
  slug: string,
  _previous: PairedImportState,
  formData: FormData,
): Promise<PairedImportState> {
  const pasted = (name: string): string => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  const fail = (message: string): PairedImportState => ({
    status: "error",
    message,
    product: pasted("product_roadmap"),
    technical: pasted("technical_roadmap"),
  });

  const db = getDb();
  const [project] = await db
    .select({ id: projects.id, isDemo: projects.isDemo })
    .from(projects)
    .where(eq(projects.slug, slug));
  if (!project) return fail("Project not found.");
  if (isViewOnly(project)) {
    return fail("This project is view-only on this server.");
  }
  const input = await readPairedRoadmapInput(formData);
  if (!input.ok) return fail(input.message);

  // The sample output cites the sample's own rows, so without a model nothing else can be read.
  const noModel = isPublicDeployment() ? demoModels() === null : isDemoLLM();
  if (noModel && !isPairedSample(input.product, input.technical)) {
    return fail(
      "Without an AI model, only the sample roadmaps can be imported together. Load the sample, or import one roadmap at a time.",
    );
  }
  const demoFixtures = pairedImportFixturesFor(input.product, input.technical);
  try {
    const { proposalId, summary } = await runPairedImport(
      db,
      isPublicDeployment()
        ? getDemoLLMProvider(demoFixtures)
        : getLLMProvider(demoFixtures),
      project.id,
      input.product,
      input.technical,
    );
    refresh();
    return {
      status: "success",
      summary,
      reviewHref: `/p/${slug}/review#proposal-${proposalId}`,
    };
  } catch (error) {
    if (error instanceof LLMOutputError) return fail(error.message);
    console.error("Paired roadmap import failed:", error);
    return fail(
      "Something went wrong while generating the proposal, so nothing was saved. Please try again.",
    );
  }
}

/**
 * Return the paired sample's two roadmaps, so the page only sends them when someone asks.
 *
 * Returns:
 *   The sample product roadmap and technical roadmap.
 */
export async function loadPairedSample(): Promise<{
  product: string;
  technical: string;
}> {
  return { product: PAIRED_SAMPLE.product, technical: PAIRED_SAMPLE.technical };
}
