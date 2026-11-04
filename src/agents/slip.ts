/** Slip check: after reconciliation changes an outcome's work, flags a target its open requirements make unlikely and proposes a new one. Exports runSlipCheck, loadSlipContext, buildSlipPrompt, slipOutputSchema, SLIP_TASK. */
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import type { LLMProvider, StructuredPrompt } from "@/adapters/llm/provider";
import { outcomeTargetOperations } from "@/core/planning";
import { loadRoadmap, type RequirementTree } from "@/core/roadmap";
import {
  formatTarget,
  hasOpenWork,
  isLater,
  lateRequirements,
  targetEnd,
  targetSchema,
} from "@/core/schedule";
import type { Database } from "@/db/client";
import { outcomes, proposals } from "@/db/schema";

import { RECONCILE_ACTOR } from "./reconcile";

export const SLIP_TASK = "slip_check";

const text = z.string().trim().min(1);

/** Why the outcome's target looks unlikely. At least one is true, or the check does not run. */
export type SlipContext = {
  projectId: string;
  /** Today as an ISO date, so "already passed" can be judged. */
  today: string;
  outcome: {
    key: string;
    title: string;
    description: string;
    target: string;
  };
  requirements: RequirementTree[];
  /** Unfinished requirements due after the outcome's target. */
  late: { key: string; title: string; target: string }[];
  /** True when the target's last day is before today and work is still open. */
  passed: boolean;
};

/**
 * The schema the model's answer must match. A new target must fit what the context shows.
 *
 * Args:
 *   context: The outcome being checked.
 *
 * Returns:
 *   A schema whose new target, when given, is later than the current one, no earlier than any
 *   late requirement, and not already in the past.
 */
export function slipOutputSchema(context: SlipContext) {
  const latest = context.late
    .map((requirement) => requirement.target)
    .reduce<string | null>(
      (max, target) => (max === null || isLater(target, max) ? target : max),
      null,
    );
  return z
    .object({
      new_target: targetSchema
        .nullable()
        .describe(
          "The new target as a quarter ('2027-Q2') or, for a fixed deadline, a date ('2027-05-01'). Null when the evidence says the current target will still be met.",
        ),
      summary: text
        .max(120)
        .describe(
          "One plain-language line for the review queue, e.g. 'Move scheduled reports to Q2 2027'.",
        ),
      rationale: text.describe(
        "Two to four sentences for the reviewer: which work makes the current target unlikely, and why you chose the new one.",
      ),
      reason: text.describe(
        "One sentence for sales and leadership, in plain language with no ticket numbers or jargon, saying why the date moved. E.g. 'Handling bounced emails turned out to be its own piece of work.' It follows 'Moved from Q1 2027 to Q2 2027.'",
      ),
    })
    .superRefine((output, ctx) => {
      const target = output.new_target;
      if (target === null) return;
      const problem = !isLater(target, context.outcome.target)
        ? `new_target must be later than the current target ${context.outcome.target}.`
        : latest && isLater(latest, target)
          ? `new_target must be no earlier than ${latest}, the latest target of the open work.`
          : targetEnd(target) < context.today
            ? `new_target must not already have passed; today is ${context.today}.`
            : null;
      if (problem) {
        ctx.addIssue({
          code: "custom",
          path: ["new_target"],
          message: problem,
        });
      }
    });
}

export type SlipOutput = z.output<ReturnType<typeof slipOutputSchema>>;

const SYSTEM_PROMPT = `You check whether a product outcome will still land by its target date, for Throughline, a tool that keeps product and technical roadmaps in sync.

You get one outcome, its target, today's date, and every requirement under it with its status and, where one is set, its own target. Throughline only asks when there is a warning sign: some open work is due after the outcome's target, or the target has already passed while work is still open. A person reviews your answer before anything changes.

Decide whether the target should move, and if so to when.

Rules:
- Prefer a quarter ('2027-Q2') unless the current target is a fixed date.
- The new target must be later than the current one, no earlier than the latest target of the open work, and not in the past.
- Pick the earliest target the evidence supports. Do not pad it.
- Answer null for new_target only when the late work is clearly not needed for customers to get the outcome, for example a follow-up that can ship after it.
- Write the reason for sales and leadership: plain language, no ticket numbers, branch names or engineering jargon.`;

/**
 * Build the prompt for one slip check.
 *
 * Args:
 *   context: The outcome, its requirements and the warning signs.
 *
 * Returns:
 *   The structured prompt.
 */
export function buildSlipPrompt(context: SlipContext): StructuredPrompt {
  const { outcome } = context;
  const describe = (node: RequirementTree, depth: number): string[] => [
    `${"  ".repeat(depth)}- ${node.key} ${node.title} (${node.status ?? "split into smaller pieces"}${node.target ? `, target ${node.target}` : ""})${node.splitReason ? ` split because: ${node.splitReason}` : ""}`,
    ...node.children.flatMap((child) => describe(child, depth + 1)),
  ];
  const lines = [
    `Today: ${context.today}`,
    `Product outcome ${outcome.key}: ${outcome.title}`,
    outcome.description,
    `Target: ${outcome.target} (${formatTarget(outcome.target)}, ends ${targetEnd(outcome.target)})`,
    "",
    "Requirements:",
    ...context.requirements.flatMap((node) => describe(node, 0)),
    "",
    "Warning signs:",
    ...context.late.map(
      (r) => `- ${r.key} ${r.title} is due ${r.target}, after the target.`,
    ),
    ...(context.passed
      ? ["- The target has passed and work is still open."]
      : []),
  ];
  return {
    task: SLIP_TASK,
    description:
      "Record whether the outcome's target should move, and to when.",
    system: SYSTEM_PROMPT,
    user: lines.join("\n"),
  };
}

/**
 * Gather an outcome's schedule and decide whether there is a warning sign worth asking about.
 *
 * Args:
 *   db: Database to read.
 *   outcomeId: The outcome to check.
 *   today: Today as an ISO date.
 *
 * Returns:
 *   The context, or null when there is nothing to check: the outcome is gone, archived, has no
 *   target or no open work, or nothing makes its target look unlikely.
 */
export async function loadSlipContext(
  db: Database,
  outcomeId: string,
  today: string,
): Promise<SlipContext | null> {
  const [row] = await db
    .select({ projectId: outcomes.projectId })
    .from(outcomes)
    .where(eq(outcomes.id, outcomeId));
  if (!row) return null;
  // loadRoadmap leaves archived outcomes out, so they are skipped here too.
  const outcome = (await loadRoadmap(db, row.projectId)).find(
    (o) => o.id === outcomeId,
  );
  if (!outcome?.target || !hasOpenWork(outcome.requirements)) return null;

  const late = lateRequirements(outcome.target, outcome.requirements).map(
    (r) => ({ key: r.key, title: r.title, target: r.target! }),
  );
  const passed = targetEnd(outcome.target) < today;
  if (late.length === 0 && !passed) return null;

  return {
    projectId: row.projectId,
    today,
    outcome: {
      key: outcome.key,
      title: outcome.title,
      description: outcome.description,
      target: outcome.target,
    },
    requirements: outcome.requirements,
    late,
    passed,
  };
}

/**
 * Check one outcome's target and, if it should move, save a pending reschedule proposal.
 *
 * The model is only asked when there is a warning sign (see loadSlipContext). A new proposal
 * supersedes any older pending one for the same outcome, which was made with less in view.
 *
 * Args:
 *   db: Database to read and write.
 *   llm: Provider that judges the schedule.
 *   outcomeId: The outcome to check.
 *   today: Today as an ISO date.
 *
 * Returns:
 *   The new proposal's id, or null when nothing should move.
 *
 * Raises:
 *   LLMOutputError: The model did not produce valid output after one retry.
 */
export async function runSlipCheck(
  db: Database,
  llm: LLMProvider,
  outcomeId: string,
  today: string,
): Promise<string | null> {
  const context = await loadSlipContext(db, outcomeId, today);
  if (!context) return null;
  const output = await llm.generateStructured(
    slipOutputSchema(context),
    buildSlipPrompt(context),
  );
  if (output.new_target === null) return null;

  const { outcome } = context;
  return db.transaction(async (tx) => {
    await tx
      .update(proposals)
      .set({
        status: "superseded",
        decidedBy: RECONCILE_ACTOR,
        decidedAt: new Date(),
      })
      .where(
        and(
          eq(proposals.projectId, context.projectId),
          eq(proposals.source, "reschedule"),
          eq(proposals.status, "pending"),
          sql`${proposals.operations} @> ${JSON.stringify([{ outcome_key: outcome.key }])}::jsonb`,
        ),
      );
    const [proposal] = await tx
      .insert(proposals)
      .values({
        projectId: context.projectId,
        source: "reschedule",
        summary: output.summary,
        rationale: output.rationale,
        operations: outcomeTargetOperations(
          outcome,
          output.new_target,
          output.reason,
        ),
      })
      .returning({ id: proposals.id });
    return proposal.id;
  });
}
