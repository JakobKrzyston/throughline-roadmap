/** /p/[slug]/tech: the technical view, outcome → requirement → work item tree and split history for engineering. */
import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { type ReactElement, Suspense } from "react";

import { Badge } from "@/components/badge";
import { loadRoadmap, loadSplitHistory } from "@/core/roadmap";
import { outcomeProgress } from "@/core/rollup";
import { formatTarget } from "@/core/product-text";
import { lateRequirements } from "@/core/schedule";
import { getDb } from "@/db/client";
import { projects } from "@/db/schema";

import { ProjectNav } from "../project-nav";
import { RequirementList, SUMMARY_CLASS } from "./requirement-tree";

/**
 * Technical view: a static heading plus the project's requirement tree and split history.
 *
 * Args:
 *   params: Route params holding the project slug.
 *
 * Returns:
 *   The page.
 */
export default function TechPage({
  params,
}: PageProps<"/p/[slug]/tech">): ReactElement {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          Technical roadmap
        </h1>
        <p className="text-muted-foreground">
          Every outcome with the requirements that deliver it and the issues and
          pull requests linked to each one. Open or close a row to see more.
        </p>
      </div>
      {/* The tree is read per request; the heading above is the static shell. */}
      <Suspense
        fallback={<p className="text-muted-foreground">Loading the roadmap…</p>}
      >
        <TechView params={params} />
      </Suspense>
    </main>
  );
}

async function TechView({
  params,
}: Pick<PageProps<"/p/[slug]/tech">, "params">): Promise<ReactElement> {
  const { slug } = await params;
  // The database read is uncached, so render this part per request rather than prerendering it.
  await connection();
  const db = getDb();
  const [project] = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(eq(projects.slug, slug));
  if (!project) notFound();

  const roadmap = await loadRoadmap(db, project.id);
  const splits = await loadSplitHistory(db, project.id, roadmap);

  return (
    <>
      <ProjectNav slug={slug} name={project.name} current="/tech" />

      <section aria-labelledby="tree" className="flex flex-col gap-4">
        <h2 id="tree" className="text-xl font-semibold">
          Outcomes and requirements
        </h2>
        {roadmap.length === 0 ? (
          <p className="rounded-md border border-border p-6 text-center text-muted-foreground">
            No outcomes yet.{" "}
            <Link
              href={`/p/${slug}/import`}
              className="font-medium text-foreground underline"
            >
              Import a roadmap
            </Link>{" "}
            to create outcomes and requirements.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {roadmap.map((outcome) => (
              <li
                key={outcome.id}
                className="rounded-lg border border-border p-4"
              >
                <details open>
                  <summary className={SUMMARY_CLASS}>
                    <span className="font-mono text-sm text-muted-foreground">
                      {outcome.key}
                    </span>
                    <span className="font-semibold">{outcome.title}</span>
                    <Badge tone="blue">
                      {Math.round(outcomeProgress(outcome.requirements) * 100)}%
                      done
                    </Badge>
                    {outcome.target && (
                      <span className="text-xs text-muted-foreground">
                        Target {formatTarget(outcome.target)}
                      </span>
                    )}
                  </summary>
                  <div className="pt-2">
                    {outcome.requirements.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No requirements yet.
                      </p>
                    ) : (
                      <RequirementList
                        requirements={outcome.requirements}
                        lateKeys={
                          new Set(
                            lateRequirements(
                              outcome.target,
                              outcome.requirements,
                            ).map((r) => r.key),
                          )
                        }
                      />
                    )}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="splits" className="flex flex-col gap-4">
        <h2 id="splits" className="text-xl font-semibold">
          Split history
        </h2>
        {splits.length === 0 ? (
          <p className="text-muted-foreground">
            No requirement has been split yet. When work turns out bigger than
            planned, the split and its reason are recorded here.
          </p>
        ) : (
          <ol className="flex flex-col gap-4">
            {splits.map((split) => (
              <li key={split.id} className="flex flex-col gap-1">
                <p>
                  <span className="font-mono text-sm">
                    {split.requirementKey}
                  </span>{" "}
                  {split.requirementTitle} was split into{" "}
                  {split.children
                    .map((child) => `${child.key} ${child.title}`)
                    .join(", ")}
                  .
                </p>
                <p className="text-sm text-muted-foreground">
                  <time dateTime={split.at.toISOString()}>
                    {split.at.toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                      timeZone: "UTC",
                    })}
                  </time>
                  : {split.reason}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
