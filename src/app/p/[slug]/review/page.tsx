/** /p/[slug]/review: the review queue, where a person approves, edits or rejects pending proposals. */
import { and, desc, eq, inArray } from "drizzle-orm";
import { Check, X } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { type ReactElement, Suspense } from "react";

import { Badge, type BadgeTone } from "@/components/badge";
import { CardsSkeleton } from "@/components/skeleton";
import { operationListSchema } from "@/core/operations";
import {
  describeOperations,
  type GraphSnapshot,
  readableSummary,
} from "@/core/proposal-diff";
import { getDb } from "@/db/client";
import {
  feedback,
  outcomes,
  projects,
  proposals,
  requirements,
  workItems,
} from "@/db/schema";
import { isPublicDeployment, isViewOnly } from "@/lib/public-deployment";

import { ViewOnlyNotice } from "../view-only-notice";
import type { ProposalView } from "./proposal-card";
import { type DecidedView, ReviewQueue } from "./review-queue";

// Approving a link can start a reconciliation after the response; allow it time to finish.
export const maxDuration = 300;

type Source = typeof proposals.$inferSelect.source;

const SOURCES: Record<Source, { label: string; tone: BadgeTone }> = {
  reschedule: { label: "Target at risk", tone: "amber" },
  import: { label: "Roadmap import", tone: "blue" },
  feedback_match: { label: "Customer feedback", tone: "purple" },
  reconcile: { label: "Planned vs. shipped", tone: "green" },
  link_suggest: { label: "Suggested link", tone: "neutral" },
  explicit_link: { label: "Linked by reference", tone: "neutral" },
  work_started: { label: "Work started", tone: "neutral" },
  manual: { label: "Planning change", tone: "neutral" },
};

export const metadata = { title: "Review queue" };

// The sources that wait in this queue for a person, and where an approved one shows. The others
// are approved as they are made, by the GitHub sync or by a person on the plan or feedback page.
const REVIEWED: Partial<Record<Source, { path: string; label: string }>> = {
  reschedule: { path: "/plan", label: "plan" },
  import: { path: "/tech", label: "technical view" },
  feedback_match: { path: "/feedback", label: "feedback page" },
  reconcile: { path: "/tech", label: "technical view" },
  link_suggest: { path: "/tech", label: "technical view" },
};
const RECENT_LIMIT = 5;

/**
 * Review page: a static heading plus the project's pending proposals.
 *
 * Args:
 *   params: Route params holding the project slug.
 *
 * Returns:
 *   The page.
 */
export default function ReviewPage({
  params,
}: PageProps<"/p/[slug]/review">): ReactElement {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Review queue</h1>
        <p className="text-muted-foreground">
          Throughline&rsquo;s agents suggest changes to the roadmap here.
          Nothing changes until you approve a proposal.
        </p>
      </div>
      {/* The proposals are read per request; the heading above is the static shell. */}
      <Suspense fallback={<CardsSkeleton />}>
        <PendingProposals params={params} />
      </Suspense>
    </main>
  );
}

async function PendingProposals({
  params,
}: Pick<PageProps<"/p/[slug]/review">, "params">): Promise<ReactElement> {
  const { slug } = await params;
  // The database read is uncached, so render this part per request rather than prerendering it.
  await connection();
  const db = getDb();
  const [project] = await db
    .select({ id: projects.id, name: projects.name, isDemo: projects.isDemo })
    .from(projects)
    .where(eq(projects.slug, slug));
  if (!project) notFound();

  const pending = await db
    .select()
    .from(proposals)
    .where(
      and(eq(proposals.projectId, project.id), eq(proposals.status, "pending")),
    )
    // Proposals made in one transaction share created_at; the id keeps their order the same on
    // every refresh, so cards do not swap places after a decision.
    .orderBy(desc(proposals.createdAt), desc(proposals.id));
  // Validate before reading anything from the operations, so one malformed proposal shows up as
  // reject-only instead of breaking the page.
  const parsedOperations = pending.map((proposal) =>
    operationListSchema.safeParse(proposal.operations),
  );
  const workItemIds = pending.flatMap((proposal, i) => {
    const parsed = parsedOperations[i];
    return [
      ...(proposal.triggerWorkItemId ? [proposal.triggerWorkItemId] : []),
      ...(parsed.success
        ? parsed.data.flatMap((op) =>
            "work_item_id" in op ? [op.work_item_id] : [],
          )
        : []),
    ];
  });
  const feedbackIds = pending.flatMap((proposal) =>
    proposal.triggerFeedbackId ? [proposal.triggerFeedbackId] : [],
  );
  const [graph, decidedRows] = await Promise.all([
    loadSnapshot(project.id, workItemIds, feedbackIds),
    db
      .select()
      .from(proposals)
      .where(
        and(
          eq(proposals.projectId, project.id),
          inArray(proposals.status, ["approved", "rejected"]),
          inArray(proposals.source, Object.keys(REVIEWED) as Source[]),
        ),
      )
      .orderBy(desc(proposals.decidedAt))
      .limit(RECENT_LIMIT),
  ]);

  const viewOnly = isViewOnly(project);
  // Visitors' edits would show on the public demo until the nightly reset.
  const canEdit = !isPublicDeployment();
  const views = pending.map((proposal, i): ProposalView => {
    const parsed = parsedOperations[i];
    const trigger = proposal.triggerWorkItemId
      ? graph.workItems.get(proposal.triggerWorkItemId)
      : proposal.triggerFeedbackId
        ? graph.feedback.get(proposal.triggerFeedbackId)
        : undefined;
    return {
      id: proposal.id,
      summary: readableSummary(proposal.summary, graph),
      rationale: proposal.rationale,
      sourceLabel: SOURCES[proposal.source].label,
      sourceTone: SOURCES[proposal.source].tone,
      createdAt: proposal.createdAt.toISOString(),
      createdOn: formatDay(proposal.createdAt),
      trigger: trigger && { title: trigger.title, url: trigger.url },
      operations: parsed.success ? parsed.data : null,
      entries: parsed.success ? describeOperations(parsed.data, graph) : [],
    };
  });
  const kinds = Object.entries(SOURCES).flatMap(([source, kind]) => {
    const count = pending.filter((p) => p.source === source).length;
    return count > 0 ? [{ ...kind, count }] : [];
  });
  // Approved and rejected proposals always have a decider and a time.
  const decided = decidedRows.map((row): DecidedView => {
    const where = REVIEWED[row.source]!;
    return {
      id: row.id,
      summary: readableSummary(row.summary, graph),
      sourceLabel: SOURCES[row.source].label,
      approved: row.status === "approved",
      decidedBy: row.decidedBy!,
      decidedOn: formatDay(row.decidedAt!),
      where:
        row.status === "approved"
          ? { href: `/p/${slug}${where.path}`, label: where.label }
          : undefined,
    };
  });

  return (
    <>
      {viewOnly && <ViewOnlyNotice />}
      {views.length > 0 && (
        <section
          aria-label="Waiting for a decision"
          className="flex flex-col gap-2"
        >
          <p className="font-medium">
            {views.length}{" "}
            {views.length === 1 ? "proposal is" : "proposals are"} waiting for a
            decision
          </p>
          <ul aria-label="By kind" className="flex flex-wrap gap-2">
            {kinds.map((kind) => (
              <li key={kind.label}>
                <Badge tone={kind.tone}>
                  {kind.label}: {kind.count}
                </Badge>
              </li>
            ))}
          </ul>
          {!viewOnly && !canEdit && (
            <p className="text-sm text-muted-foreground">
              On the public demo you can approve or reject a proposal as it
              stands. Editing it first is turned off, so one visitor&rsquo;s
              wording does not show to everyone else.
            </p>
          )}
        </section>
      )}
      <ReviewQueue
        slug={slug}
        proposals={views}
        decided={decided}
        viewOnly={viewOnly}
        canEdit={canEdit}
      />
      {decided.length > 0 && <RecentlyDecided decided={decided} />}
    </>
  );
}

/** The last decisions made in the queue, newest first, read from the proposals themselves. */
function RecentlyDecided({
  decided,
}: {
  decided: DecidedView[];
}): ReactElement {
  return (
    <section
      aria-labelledby="recently-decided"
      className="flex flex-col gap-3 pt-4"
    >
      <h2 id="recently-decided" className="text-lg font-semibold">
        Recently decided
      </h2>
      <ol className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card text-card-foreground">
        {decided.map((view) => {
          const Icon = view.approved ? Check : X;
          return (
            <li key={view.id} className="flex gap-3 p-4 text-sm">
              <Icon
                aria-hidden
                className={`mt-0.5 size-4 shrink-0 ${view.approved ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}`}
              />
              <div className="flex min-w-0 flex-col gap-1 break-words">
                <p>
                  <span className="font-medium">
                    {view.approved ? "Approved" : "Rejected"}:
                  </span>{" "}
                  {view.summary}
                </p>
                <p className="text-muted-foreground">
                  {view.sourceLabel} · by {view.decidedBy} · {view.decidedOn}
                  {view.where && (
                    <>
                      {" · "}
                      <Link href={view.where.href} className="underline">
                        See it in the {view.where.label}
                      </Link>
                    </>
                  )}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** A date as "4 November 2026": one explicit format and time zone, as elsewhere in the app. */
function formatDay(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** The current graph values the diffs compare against, plus the given work items and feedback (ids must be valid uuids). */
async function loadSnapshot(
  projectId: string,
  workItemIds: string[],
  feedbackIds: string[],
): Promise<
  Omit<GraphSnapshot, "workItems" | "feedback"> & {
    workItems: Map<
      string,
      { title: string; kind: "issue" | "pull_request"; url: string }
    >;
    feedback: Map<string, { title: string; url: string }>;
  }
> {
  const db = getDb();
  const [outcomeRows, requirementRows, workItemRows, feedbackRows] =
    await Promise.all([
      db.select().from(outcomes).where(eq(outcomes.projectId, projectId)),
      db
        .select()
        .from(requirements)
        .where(eq(requirements.projectId, projectId)),
      workItemIds.length === 0
        ? []
        : db
            .select({
              id: workItems.id,
              title: workItems.title,
              kind: workItems.kind,
              url: workItems.url,
            })
            .from(workItems)
            .where(inArray(workItems.id, workItemIds)),
      feedbackIds.length === 0
        ? []
        : db
            .select({
              id: feedback.id,
              title: feedback.title,
              url: feedback.url,
            })
            .from(feedback)
            .where(inArray(feedback.id, feedbackIds)),
    ]);
  return {
    outcomes: new Map(outcomeRows.map((row) => [row.key, row])),
    requirements: new Map(requirementRows.map((row) => [row.key, row])),
    workItems: new Map(workItemRows.map((row) => [row.id, row])),
    feedback: new Map(feedbackRows.map((row) => [row.id, row])),
  };
}
