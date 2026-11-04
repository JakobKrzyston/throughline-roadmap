/** /p/[slug]/plan: reorder outcomes by priority and change targets, with warnings when work is due too late. */
import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { type ReactElement, Suspense } from "react";

import {
  type OutcomeTree,
  loadRoadmap,
  type RequirementTree,
} from "@/core/roadmap";
import { requirementProgress } from "@/core/rollup";
import {
  formatTarget,
  hasOpenWork,
  lateRequirements,
  targetEnd,
} from "@/core/schedule";
import { getDb } from "@/db/client";
import { projects } from "@/db/schema";
import { isPublicDeployment, isViewOnly } from "@/lib/public-deployment";

import { ProjectNav } from "../project-nav";
import { ViewOnlyNotice } from "../view-only-notice";
import { PlanBoard, type PlanOutcome } from "./plan-board";

const STATUS_LABELS: Record<NonNullable<RequirementTree["status"]>, string> = {
  planned: "planned",
  in_progress: "in progress",
  done: "done",
  dropped: "dropped",
};

/**
 * Plan page: a static heading plus the project's outcomes in priority order.
 *
 * Args:
 *   params: Route params holding the project slug.
 *
 * Returns:
 *   The page.
 */
export default function PlanPage({
  params,
}: PageProps<"/p/[slug]/plan">): ReactElement {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Plan</h1>
        <p className="text-muted-foreground">
          Drag outcomes, or use Up and Down, to set their priority, and change
          when each one should land. Every change is recorded and moves to a
          target appear in the product view&rsquo;s change feed.
        </p>
      </div>
      {/* The roadmap is read per request; the heading above is the static shell. */}
      <Suspense
        fallback={<p className="text-muted-foreground">Loading the roadmap…</p>}
      >
        <PlanView params={params} />
      </Suspense>
    </main>
  );
}

async function PlanView({
  params,
}: Pick<PageProps<"/p/[slug]/plan">, "params">): Promise<ReactElement> {
  const { slug } = await params;
  // The database read is uncached, so render this part per request rather than prerendering it.
  await connection();
  const db = getDb();
  const [project] = await db
    .select({ id: projects.id, name: projects.name, isDemo: projects.isDemo })
    .from(projects)
    .where(eq(projects.slug, slug));
  if (!project) notFound();

  const roadmap = await loadRoadmap(db, project.id);
  const today = new Date().toISOString().slice(0, 10);
  const viewOnly = isViewOnly(project);

  return (
    <>
      <ProjectNav slug={slug} name={project.name} current="/plan" />
      {viewOnly && <ViewOnlyNotice />}
      {roadmap.length === 0 ? (
        <p className="rounded-md border border-border p-6 text-center text-muted-foreground">
          No outcomes yet.{" "}
          <Link
            href={`/p/${slug}/import`}
            className="font-medium text-foreground underline"
          >
            Import a roadmap
          </Link>{" "}
          to plan its outcomes.
        </p>
      ) : (
        <PlanBoard
          slug={slug}
          outcomes={roadmap.map((outcome) => toPlanOutcome(outcome, today))}
          editable={!viewOnly}
          // Visitors' wording would show on the public demo until the nightly reset.
          allowReason={!isPublicDeployment()}
        />
      )}
    </>
  );
}

function toPlanOutcome(outcome: OutcomeTree, today: string): PlanOutcome {
  const warnings = lateRequirements(outcome.target, outcome.requirements).map(
    (r) =>
      `${r.key} ${r.title} is due ${formatTarget(r.target!)}, after this outcome's target.`,
  );
  if (
    outcome.target &&
    targetEnd(outcome.target) < today &&
    hasOpenWork(outcome.requirements)
  ) {
    warnings.push("This target has passed and work is still open.");
  }

  const flatten = (
    nodes: RequirementTree[],
    depth: number,
  ): PlanOutcome["requirements"] =>
    nodes.flatMap((node) => [
      {
        key: node.key,
        title: node.title,
        target: node.target,
        depth,
        status: node.status
          ? STATUS_LABELS[node.status]
          : `${Math.round(requirementProgress(node) * 100)}% done`,
      },
      ...flatten(node.children, depth + 1),
    ]);

  return {
    key: outcome.key,
    title: outcome.title,
    target: outcome.target,
    warnings,
    requirements: flatten(outcome.requirements, 0),
  };
}
