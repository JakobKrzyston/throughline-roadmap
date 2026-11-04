"use server";
/** Server actions behind the plan page: reorder outcomes and change targets. Exports moveOutcome, saveTarget and their state type. */
import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z, ZodError } from "zod";

import type { GraphOperationInput } from "@/core/operations";
import {
  moveOperations,
  outcomeTargetOperations,
  savePlanningChange,
} from "@/core/planning";
import { ProposalError } from "@/core/proposals";
import { loadRoadmap } from "@/core/roadmap";
import { formatTarget, targetSchema } from "@/core/schedule";
import { getDb } from "@/db/client";
import { projects } from "@/db/schema";
import { isPublicDeployment, isViewOnly } from "@/lib/public-deployment";

/** Recorded as the actor until there is sign-in (see the "Teams and permissions" issue). */
const PLANNER = "planner";

export type PlanState =
  { status: "idle" } | { status: "error"; message: string };

const moveSchema = z.object({
  key: z.string().min(1),
  toIndex: z.number().int().min(0),
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
 * Move one outcome to a new place in the priority order.
 *
 * Args:
 *   slug: The project's slug.
 *   key: The outcome to move.
 *   toIndex: Its new position, 0 for the top.
 *
 * Returns:
 *   The idle state once saved (the page refreshes), or an error message to show.
 */
export async function moveOutcome(
  slug: string,
  key: string,
  toIndex: number,
): Promise<PlanState> {
  const input = moveSchema.safeParse({ key, toIndex });
  if (!input.success) return fail("That request was not understood.");

  const project = await editableProject(slug);
  if ("status" in project) return project;
  const roadmap = await loadRoadmap(getDb(), project.id);
  const outcome = roadmap.find((o) => o.key === input.data.key);
  if (!outcome) return fail("Outcome not found.");

  const operations = moveOperations(
    roadmap,
    input.data.key,
    input.data.toIndex,
  );
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
    return save(project.id, `Set ${key}'s target to ${shown}`, [
      { type: "update_requirement", requirement_key: key, target },
    ]);
  }
  const outcome = (await loadRoadmap(getDb(), project.id)).find(
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
    await savePlanningChange(getDb(), projectId, summary, operations, PLANNER);
  } catch (error) {
    if (error instanceof ProposalError) return fail(`${error.message}.`);
    if (error instanceof ZodError) return fail("That change is not valid.");
    console.error("Saving a planning change failed:", error);
    return fail("Something went wrong, so nothing changed. Please try again.");
  }
  refresh();
  return { status: "idle" };
}
