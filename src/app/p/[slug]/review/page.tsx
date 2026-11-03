/** /p/[slug]/review: the review queue, where a person approves, edits or rejects pending proposals. */
import { and, desc, eq, inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { type ReactElement, Suspense } from "react";

import { operationListSchema } from "@/core/operations";
import { describeOperations, type GraphSnapshot } from "@/core/proposal-diff";
import { getDb } from "@/db/client";
import {
  outcomes,
  projects,
  proposals,
  requirements,
  workItems,
} from "@/db/schema";

import { type ProposalView, ProposalCard } from "./proposal-card";

// Approving a link can start a reconciliation after the response; allow it time to finish.
export const maxDuration = 300;

const SOURCE_LABELS: Record<typeof proposals.$inferSelect.source, string> = {
  import: "Roadmap import",
  reconcile: "Planned vs. shipped",
  link_suggest: "Suggested link",
  explicit_link: "Linked by reference",
};

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
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Review queue</h1>
        <p className="text-muted-foreground">
          Throughline&rsquo;s agents suggest changes to the roadmap here.
          Nothing changes until you approve a proposal, and you can edit its
          wording first.
        </p>
      </div>
      {/* The proposals are read per request; the heading above is the static shell. */}
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
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
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(eq(projects.slug, slug));
  if (!project) notFound();

  const pending = await db
    .select()
    .from(proposals)
    .where(
      and(eq(proposals.projectId, project.id), eq(proposals.status, "pending")),
    )
    .orderBy(desc(proposals.createdAt));
  const graph = await loadSnapshot(project.id, pending);

  const views = pending.map((proposal): ProposalView => {
    const parsed = operationListSchema.safeParse(proposal.operations);
    const trigger = proposal.triggerWorkItemId
      ? graph.workItems.get(proposal.triggerWorkItemId)
      : undefined;
    return {
      id: proposal.id,
      summary: proposal.summary,
      rationale: proposal.rationale,
      sourceLabel: SOURCE_LABELS[proposal.source],
      createdAt: proposal.createdAt.toISOString(),
      trigger: trigger && { title: trigger.title, url: trigger.url },
      operations: parsed.success ? parsed.data : null,
      entries: parsed.success ? describeOperations(parsed.data, graph) : [],
    };
  });

  return (
    <>
      <p className="text-sm text-muted-foreground">
        Project: <span className="font-medium">{project.name}</span>
      </p>
      {views.length === 0 ? (
        <p className="rounded-md border border-border p-6 text-center text-muted-foreground">
          Nothing to review. Proposals appear here when you import a roadmap or
          when linked work ships.
        </p>
      ) : (
        <ol className="flex flex-col gap-6">
          {views.map((view) => (
            <li key={view.id}>
              <ProposalCard slug={slug} proposal={view} />
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

/** The current graph values the diffs compare against, plus the work items the proposals mention. */
async function loadSnapshot(
  projectId: string,
  pending: (typeof proposals.$inferSelect)[],
): Promise<
  Omit<GraphSnapshot, "workItems"> & {
    workItems: Map<
      string,
      { title: string; kind: "issue" | "pull_request"; url: string }
    >;
  }
> {
  const db = getDb();
  const workItemIds = pending.flatMap((proposal) => [
    ...(proposal.triggerWorkItemId ? [proposal.triggerWorkItemId] : []),
    ...proposal.operations.flatMap((op) =>
      "work_item_id" in op ? [op.work_item_id] : [],
    ),
  ]);
  const [outcomeRows, requirementRows, workItemRows] = await Promise.all([
    db.select().from(outcomes).where(eq(outcomes.projectId, projectId)),
    db.select().from(requirements).where(eq(requirements.projectId, projectId)),
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
  ]);
  return {
    outcomes: new Map(outcomeRows.map((row) => [row.key, row])),
    requirements: new Map(requirementRows.map((row) => [row.key, row])),
    workItems: new Map(workItemRows.map((row) => [row.id, row])),
  };
}
