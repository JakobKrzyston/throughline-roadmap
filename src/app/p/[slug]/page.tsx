/** /p/[slug]: the product view, the state of the product in plain language for sales and leadership. */
import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { type ReactElement, Suspense } from "react";

import { buttonVariants } from "@/components/ui/button";
import { loadRecentChanges, loadRoadmap } from "@/core/roadmap";
import { getDb } from "@/db/client";
import { projects } from "@/db/schema";

import { OutcomeCard } from "./outcome-card";
import { ProjectNav } from "./project-nav";

/**
 * Product view: a static heading plus the project's outcomes and recent changes.
 *
 * Args:
 *   params: Route params holding the project slug.
 *   searchParams: `detail=1` shows requirement keys.
 *
 * Returns:
 *   The page.
 */
export default function ProductPage({
  params,
  searchParams,
}: PageProps<"/p/[slug]">): ReactElement {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          Product roadmap
        </h1>
        <p className="text-muted-foreground">
          What customers can use today, what is on the way, and what changed
          this week.
        </p>
      </div>
      {/* The roadmap is read per request; the heading above is the static shell. */}
      <Suspense
        fallback={<p className="text-muted-foreground">Loading the roadmap…</p>}
      >
        <ProductView params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function ProductView({
  params,
  searchParams,
}: Pick<
  PageProps<"/p/[slug]">,
  "params" | "searchParams"
>): Promise<ReactElement> {
  const { slug } = await params;
  // Ticket numbers stay out of the page entirely unless the reader asks for them.
  const showDetail = (await searchParams).detail === "1";
  // The database read is uncached, so render this part per request rather than prerendering it.
  await connection();
  const db = getDb();
  const [project] = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(eq(projects.slug, slug));
  if (!project) notFound();

  const [roadmap, changes] = await Promise.all([
    loadRoadmap(db, project.id),
    loadRecentChanges(db, project.id),
  ]);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ProjectNav slug={slug} name={project.name} current="" />
        <Link
          href={showDetail ? `/p/${slug}` : `/p/${slug}?detail=1`}
          scroll={false}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          {showDetail ? "Hide technical detail" : "Show technical detail"}
        </Link>
      </div>

      <section aria-labelledby="outcomes" className="flex flex-col gap-4">
        <h2 id="outcomes" className="text-xl font-semibold">
          Outcomes
        </h2>
        {roadmap.length === 0 ? (
          <p className="rounded-md border border-border p-6 text-center text-muted-foreground">
            This roadmap is empty.{" "}
            <Link
              href={`/p/${slug}/import`}
              className="font-medium text-foreground underline"
            >
              Import a roadmap
            </Link>{" "}
            to describe what customers will get.
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {roadmap.map((outcome) => (
              <li key={outcome.id}>
                <OutcomeCard outcome={outcome} showDetail={showDetail} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="changes" className="flex flex-col gap-4">
        <h2 id="changes" className="text-xl font-semibold">
          What changed this week
        </h2>
        {changes.length === 0 ? (
          <p className="text-muted-foreground">
            Nothing changed this week. Changes appear here when work is finished
            or plans change.
          </p>
        ) : (
          <ol className="flex flex-col gap-4">
            {changes.map((change) => (
              <li key={change.id} className="flex flex-col gap-1">
                <p>{change.note}</p>
                <p className="text-sm text-muted-foreground">
                  <time dateTime={change.at.toISOString()}>
                    {change.at.toLocaleDateString("en-GB", {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                    })}
                  </time>
                  {change.outcomeTitle && ` · ${change.outcomeTitle}`}
                  {showDetail && change.entityKey && (
                    <span className="ml-2 font-mono">{change.entityKey}</span>
                  )}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
