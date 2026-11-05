"use server";
/** Server actions behind the feedback page: link feedback to an outcome by hand, or unlink it. Exports linkFeedback, unlinkFeedback and their state type. */
import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { saveFeedbackLink } from "@/core/feedback";
import { ProposalError } from "@/core/proposals";
import { getDb } from "@/db/client";
import { projects } from "@/db/schema";
import { isViewOnly } from "@/lib/public-deployment";

/** Recorded as the actor until there is sign-in (see the "Teams and permissions" issue). */
const PLANNER = "planner";

export type FeedbackState =
  { status: "idle" } | { status: "error"; message: string };

const changeSchema = z.object({
  feedbackId: z.uuid(),
  outcomeKey: z.string().trim().min(1),
});

/**
 * Link a piece of feedback to the outcome chosen in the form.
 *
 * Args:
 *   slug: The project's slug, bound by the page.
 *   feedbackId: The feedback, bound by the page.
 *   _previous: The form's previous state (unused; required by useActionState).
 *   formData: `outcome`, the outcome's key.
 *
 * Returns:
 *   The idle state once saved (the page refreshes), or an error message to show.
 */
export async function linkFeedback(
  slug: string,
  feedbackId: string,
  _previous: FeedbackState,
  formData: FormData,
): Promise<FeedbackState> {
  return save(slug, feedbackId, formData.get("outcome"), true);
}

/**
 * Unlink a piece of feedback from an outcome.
 *
 * Args:
 *   slug: The project's slug, bound by the page.
 *   feedbackId: The feedback, bound by the page.
 *   outcomeKey: The outcome to unlink it from, bound by the page.
 *
 * Returns:
 *   The idle state once saved, or an error message to show.
 */
export async function unlinkFeedback(
  slug: string,
  feedbackId: string,
  outcomeKey: string,
): Promise<FeedbackState> {
  return save(slug, feedbackId, outcomeKey, false);
}

async function save(
  slug: string,
  feedbackId: unknown,
  outcomeKey: unknown,
  link: boolean,
): Promise<FeedbackState> {
  const input = changeSchema.safeParse({ feedbackId, outcomeKey });
  if (!input.success) return fail("Choose an outcome first.");

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
    await saveFeedbackLink(db, project.id, { ...input.data, link }, PLANNER);
  } catch (error) {
    if (error instanceof ProposalError) return fail(`${error.message}.`);
    console.error("Saving a feedback link failed:", error);
    return fail("Something went wrong, so nothing changed. Please try again.");
  }
  refresh();
  return { status: "idle" };
}

function fail(message: string): FeedbackState {
  return { status: "error", message };
}
