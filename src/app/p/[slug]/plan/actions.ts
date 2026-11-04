"use server";
/** Server actions behind the plan page: reorder outcomes and change targets. Exports moveOutcome, saveTarget and their state type. */
import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { after } from "next/server";
import { z, ZodError } from "zod";

import type { GraphOperationInput } from "@/core/operations";
import {
  moveOperations,
  outcomeTargetOperations,
  savePlanningChange,
} from "@/core/planning";
import { ProposalError } from "@/core/proposals";
import { loadOutcomes } from "@/core/roadmap";
import { formatTarget } from "@/core/product-text";
import { targetSchema } from "@/core/schedule";
import { getDb } from "@/db/client";
import { projects, requirements } from "@/db/schema";
import { runQueuedJobs } from "@/jobs";
import { isPublicDeployment, isViewOnly } from "@/lib/public-deployment";

/** Recorded as the actor until there is sign-in (see the "Teams and permissions" issue). */
const PLANNER = "planner";

export type PlanState =
  { status: "idle" } | { status: "error"; message: string };

const moveSchema = z.object({
  key: z.string().min(1),
  toKey: z.string().min(1),
});

const targetFormSchema = z.object({
  kind: z.enum(["outcome", "requirement"]),
  key: z.string().min(1),
  // An empty box clears the target.
  target: z
    .string()
    .trim()
    .transform((value) => value || null)
    .pipe(targetSchema.nullable()),
  reason: z.string().trim().max(500).optional(),
});

/**
 * Move one outcome to where another one is now in the priority order.
 *
 * The destination is named by key rather than position, so a page that is out of date because
 * someone else reordered meanwhile still puts the outcome where the person dropped it.
 *
 * Args:
 *   slug: The project's slug.
 *   key: The outcome to move.
 *   toKey: The outcome whose place it takes; that one and those between shift by one.
 *
 * Returns:
 *   The idle state once saved (the page refreshes), or an error message to show.
 */
export async function moveOutcome(
  slug: string,
  key: string,
  toKey: string,
): Promise<PlanState> {
  const input = moveSchema.safeParse({ key, toKey });
  if (!input.success) return fail("That request was not understood.");

  const project = await editableProject(slug);
  if ("status" in project) return project;
  const ordered = await loadOutcomes(getDb(), project.id);
  const outcome = ordered.find((o) => o.key === input.data.key);
  const toIndex = ordered.findIndex((o) => o.key === input.data.toKey);
  if (!outcome || toIndex === -1) return fail("Outcome not found.");

  const operations = moveOperations(ordered, input.data.key, toIndex);
  return save(
    project.id,
    `Move “${outcome.title}” in the priority order`,
    operations,
  );
}

/**
 * Set or clear the target of an outcome or a requirement.
 *
 * Args:
 *   slug: The project's slug, bound by the page.
 *   _previous: The form's previous state (unused; required by useActionState).
 *   formData: `kind` (`outcome` or `requirement`), `key`, `target` (empty to clear) and, for an
 *     outcome, an optional plain-language `reason` added to the change feed.
 *
 * Returns:
 *   The idle state once saved, or an error message to show.
 */
export async function saveTarget(
  slug: string,
  _previous: PlanState,
  formData: FormData,
): Promise<PlanState> {
  const input = targetFormSchema.safeParse(Object.fromEntries(formData));
  if (!input.success) {
    const targetIssue = input.error.issues.find((i) => i.path[0] === "target");
    return fail(
      targetIssue
        ? "Use a quarter like 2027-Q1 or a date like 2027-01-11, or leave it empty."
        : "That request was not understood.",
    );
  }
  const { kind, key, target, reason } = input.data;
  // Visitors' wording would show on the public demo's change feed until the nightly reset.
  if (reason && isPublicDeployment()) {
    return fail("Notes are turned off on this server. Save without one.");
  }

  const project = await editableProject(slug);
  if ("status" in project) return project;
  const shown = target ? formatTarget(target) : "no target";

  if (kind === "requirement") {
    const [requirement] = await getDb()
      .select({ target: requirements.target })
      .from(requirements)
      .where(
        and(eq(requirements.projectId, project.id), eq(requirements.key, key)),
      );
    if (!requirement) return fail(`Requirement ${key} not found.`);
    // An update must change something, so saving the same target is a no-op.
    if (requirement.target === target) return { status: "idle" };
    return save(project.id, `Set ${key}'s target to ${shown}`, [
      { type: "update_requirement", requirement_key: key, target },
    ]);
  }
  const outcome = (await loadOutcomes(getDb(), project.id)).find(
    (o) => o.key === key,
  );
  if (!outcome) return fail("Outcome not found.");
  return save(
    project.id,
    `Move “${outcome.title}” to ${shown}`,
    outcomeTargetOperations(outcome, target, reason),
  );
}

function fail(message: string): PlanState {
  return { status: "error", message };
}

async function editableProject(
  slug: string,
): Promise<{ id: string } | PlanState> {
  const [project] = await getDb()
    .select({ id: projects.id, isDemo: projects.isDemo })
    .from(projects)
    .where(eq(projects.slug, slug));
  if (!project) return fail("Project not found.");
  if (isViewOnly(project)) {
    return fail("This project is view-only on this server.");
  }
  return project;
}

async function save(
  projectId: string,
  summary: string,
  operations: GraphOperationInput[],
): Promise<PlanState> {
  if (operations.length === 0) return { status: "idle" };
  try {
    const { checksQueued } = await savePlanningChange(
      getDb(),
      projectId,
      summary,
      operations,
      PLANNER,
    );
    // A changed target is checked against the outcome's work again, after the response is sent.
    if (checksQueued > 0) after(runQueuedJobs);
  } catch (error) {
    if (error instanceof ProposalError) return fail(`${error.message}.`);
    if (error instanceof ZodError) return fail("That change is not valid.");
    console.error("Saving a planning change failed:", error);
    return fail("Something went wrong, so nothing changed. Please try again.");
  }
  refresh();
  return { status: "idle" };
}
