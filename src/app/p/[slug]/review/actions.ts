"use server";
/** Server action behind the review queue. Exports decideProposal and its state type. */
import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { after } from "next/server";
import { z, ZodError } from "zod";

import { ProposalError, rejectProposal } from "@/core/proposals";
import { approveProposal } from "@/core/review";
import { getDb } from "@/db/client";
import { projects, proposals } from "@/db/schema";
import { runQueuedJobs } from "@/jobs";
import { isPublicDeployment, isViewOnly } from "@/lib/public-deployment";

/** Recorded as the decider until there is sign-in (see the "Teams and permissions" issue). */
const REVIEWER = "reviewer";

export type DecideState =
  { status: "idle" } | { status: "error"; message: string };

const decisionSchema = z.object({
  proposalId: z.uuid(),
  decision: z.enum(["approve", "reject"]),
  // The edited operations as JSON, present only for "edit then approve".
  operations: z.string().optional(),
});

/**
 * Approve, edit then approve, or reject one pending proposal.
 *
 * Args:
 *   slug: The project's slug, bound by the page.
 *   _previous: The form's previous state (unused; required by useActionState).
 *   formData: `proposalId`, `decision` (`approve` or `reject`) and, after an edit, `operations`.
 *
 * Returns:
 *   The idle state once decided (the page refreshes and the proposal leaves the queue), or an
 *   error message to show on the proposal.
 */
export async function decideProposal(
  slug: string,
  _previous: DecideState,
  formData: FormData,
): Promise<DecideState> {
  const fail = (message: string): DecideState => ({ status: "error", message });
  const input = decisionSchema.safeParse(Object.fromEntries(formData));
  if (!input.success) return fail("That request was not understood.");
  const { proposalId, decision, operations } = input.data;

  // Visitors' wording would show on the public demo until the nightly reset.
  if (operations !== undefined && isPublicDeployment()) {
    return fail(
      "Editing is turned off on this server. Approve or reject instead.",
    );
  }
  let edited: unknown;
  if (operations !== undefined) {
    try {
      edited = JSON.parse(operations);
    } catch {
      return fail("The edits could not be read.");
    }
  }

  // Only decide proposals that belong to the project in the URL.
  const db = getDb();
  const [found] = await db
    .select({ id: proposals.id, isDemo: projects.isDemo })
    .from(proposals)
    .innerJoin(projects, eq(proposals.projectId, projects.id))
    .where(and(eq(projects.slug, slug), eq(proposals.id, proposalId)));
  if (!found) return fail("Proposal not found.");
  if (isViewOnly(found))
    return fail("This project is view-only on this server.");

  try {
    if (decision === "reject") {
      await rejectProposal(db, proposalId, REVIEWER);
    } else if ((await approveProposal(db, proposalId, REVIEWER, edited)) > 0) {
      after(runQueuedJobs);
    }
  } catch (error) {
    if (error instanceof ProposalError) return fail(`${error.message}.`);
    if (error instanceof ZodError) {
      const issues = error.issues.map((issue) => {
        const field = issue.path.findLast((part) => typeof part === "string");
        return `${field ? `${String(field).replace("_", " ")}: ` : ""}${issue.message}`;
      });
      return fail(`The edits are not valid. ${issues.join("; ")}.`);
    }
    console.error("Deciding a proposal failed:", error);
    return fail("Something went wrong, so nothing changed. Please try again.");
  }
  refresh();
  return { status: "idle" };
}
