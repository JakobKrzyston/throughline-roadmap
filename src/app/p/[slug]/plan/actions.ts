"use server";
/** Server actions behind the plan page: reorder outcomes, change their targets, and set a requirement's target, kind of work and team. Exports moveOutcome, saveTarget, saveRequirement and their state type. */
import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { after } from "next/server";
import { z, ZodError } from "zod";

import { type GraphOperationInput, workTypeSchema } from "@/core/operations";
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

// Empty values clear the field: no target, no kind of work, or the parent's team.
const emptyToNull = (value: string): string | null => value.trim() || null;
const targetField = z
  .string()
  .transform(emptyToNull)
  .pipe(targetSchema.nullable());
const TARGET_HELP =
  "Use a quarter like 2027-Q1 or a date like 2027-01-11, or leave it empty.";

const targetFormSchema = z.object({
  key: z.string().min(1),
  target: targetField,
  reason: z.string().trim().max(500).optional(),
});

const requirementFormSchema = z.object({
  key: z.string().min(1),
  target: targetField,
  work_type: z.string().transform(emptyToNull).pipe(workTypeSchema.nullable()),
  team: z.string().transform(emptyToNull).pipe(z.string().max(60).nullable()),
});

const FIELD_NAMES = {
  target: "target",
  work_type: "kind of work",
  team: "team",
} as const;

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
 * Set or clear an outcome's target.
 *
 * Args:
 *   slug: The project's slug, bound by the page.
 *   _previous: The form's previous state (unused; required by useActionState).
 *   formData: `key`, `target` (empty to clear) and an optional plain-language `reason` added to
 *     the change feed.
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
    return fail(
      input.error.issues.some((i) => i.path[0] === "target")
        ? TARGET_HELP
        : "That request was not understood.",
    );
  }
  const { key, target, reason } = input.data;
  // Visitors' wording would show on the public demo's change feed until the nightly reset.
  if (reason && isPublicDeployment()) {
    return fail("Notes are turned off on this server. Save without one.");
  }

  const project = await editableProject(slug);
  if ("status" in project) return project;
  const outcome = (await loadOutcomes(getDb(), project.id)).find(
    (o) => o.key === key,
  );
  if (!outcome) return fail("Outcome not found.");
  return save(
    project.id,
    `Move “${outcome.title}” to ${target ? formatTarget(target) : "no target"}`,
    outcomeTargetOperations(outcome, target, reason),
  );
}

/**
 * Set a requirement's target, kind of work and team in one save.
 *
 * Args:
 *   slug: The project's slug, bound by the page.
 *   _previous: The form's previous state (unused; required by useActionState).
 *   formData: `key`, `target` (empty to clear), `work_type` (empty for none) and `team` (empty to
 *     use the parent's).
 *
 * Returns:
 *   The idle state once saved, or an error message to show.
 */
export async function saveRequirement(
  slug: string,
  _previous: PlanState,
  formData: FormData,
): Promise<PlanState> {
  const input = requirementFormSchema.safeParse(Object.fromEntries(formData));
  if (!input.success) {
    const fields = input.error.issues.map((i) => i.path[0]);
    if (fields.includes("target")) return fail(TARGET_HELP);
    return fail(
      fields.includes("team")
        ? "Keep the team name to 60 characters."
        : "That request was not understood.",
    );
  }
  const { key, target, work_type, team } = input.data;
  const project = await editableProject(slug);
  if ("status" in project) return project;

  const [requirement] = await getDb()
    .select({
      target: requirements.target,
      workType: requirements.workType,
      team: requirements.team,
    })
    .from(requirements)
    .where(
      and(eq(requirements.projectId, project.id), eq(requirements.key, key)),
    );
  if (!requirement) return fail(`Requirement ${key} not found.`);
  // Only what changed, since an update must change something and each field gets its own row in the history.
  const changes = {
    ...(requirement.target !== target ? { target } : {}),
    ...(requirement.workType !== work_type ? { work_type } : {}),
    ...(requirement.team !== team ? { team } : {}),
  };
  const changed = Object.keys(changes) as (keyof typeof FIELD_NAMES)[];
  if (changed.length === 0) return { status: "idle" };
  // Visitors' team names would show in the public demo's technical view until the nightly reset.
  if ("team" in changes && isPublicDeployment()) {
    return fail("Team names are turned off on this server.");
  }
  const named = new Intl.ListFormat("en-GB").format(
    changed.map((field) => FIELD_NAMES[field]),
  );
  return save(project.id, `Set ${key}'s ${named}`, [
    { type: "update_requirement", requirement_key: key, ...changes },
  ]);
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
