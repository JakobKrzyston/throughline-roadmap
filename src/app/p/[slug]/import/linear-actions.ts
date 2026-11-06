"use server";
/** Server actions behind the import page's "Import from Linear" form. Exports loadLinearTeams, importFromLinear and their result types. */
import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { linearSourceFor } from "@/adapters/linear";
import { LinearError, type LinearTeam } from "@/adapters/linear/source";
import { runLinearImport } from "@/agents/linear-import";
import { getDb } from "@/db/client";
import { projects } from "@/db/schema";
import { isViewOnly } from "@/lib/public-deployment";

export type LinearTeamsResult =
  { ok: true; teams: LinearTeam[] } | { ok: false; message: string };

/**
 * List the Linear teams a project can import from, when the form asks for them.
 *
 * Teams are read on request rather than with the page, so people who only paste or upload never
 * wait on Linear.
 *
 * Args:
 *   slug: The project's slug.
 *
 * Returns:
 *   The teams, or a message saying why they could not be read.
 */
export async function loadLinearTeams(
  slug: string,
): Promise<LinearTeamsResult> {
  const [project] = await getDb()
    .select({ isDemo: projects.isDemo })
    .from(projects)
    .where(eq(projects.slug, slug));
  if (!project) return { ok: false, message: "Project not found." };
  if (isViewOnly(project)) {
    return { ok: false, message: "This project is view-only on this server." };
  }
  try {
    const teams = await linearSourceFor(project).source.listTeams();
    return teams.length > 0
      ? { ok: true, teams }
      : {
          ok: false,
          message: "The Linear workspace has no teams this API key can read.",
        };
  } catch (error) {
    if (error instanceof LinearError)
      return { ok: false, message: error.message };
    console.error("Listing Linear teams failed:", error);
    return {
      ok: false,
      message: "Something went wrong while reading Linear. Please try again.",
    };
  }
}

export type LinearImportState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success"; summary: string; reviewHref: string };

const teamIdSchema = z
  .string({ error: "Choose a Linear team first." })
  .trim()
  .min(1, "Choose a Linear team first.")
  .max(100, "That Linear team was not found.");

/**
 * Read the chosen Linear team and save its roadmap as a pending proposal.
 *
 * Args:
 *   slug: The project's slug, bound by the page.
 *   _previous: The form's previous state (unused; required by useActionState).
 *   formData: Form fields; `team` holds the Linear team's id.
 *
 * Returns:
 *   A success state with a link to the review queue, or an error message to show.
 */
export async function importFromLinear(
  slug: string,
  _previous: LinearImportState,
  formData: FormData,
): Promise<LinearImportState> {
  const fail = (message: string): LinearImportState => ({
    status: "error",
    message,
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
  const teamId = teamIdSchema.safeParse(formData.get("team"));
  if (!teamId.success) return fail(teamId.error.issues[0].message);

  try {
    const { proposalId, summary } = await runLinearImport(
      db,
      linearSourceFor(project).source,
      project.id,
      teamId.data,
    );
    // The new proposal adds one to the review queue count in the top bar.
    refresh();
    return {
      status: "success",
      summary,
      reviewHref: `/p/${slug}/review#proposal-${proposalId}`,
    };
  } catch (error) {
    if (error instanceof LinearError) return fail(error.message);
    console.error("Linear import failed:", error);
    return fail(
      "Something went wrong while importing from Linear, so nothing was saved. Please try again.",
    );
  }
}
