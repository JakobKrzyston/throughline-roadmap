/** /p/[slug]: the product view, the state of the product in plain language for sales and leadership. */
import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { type ReactElement, Suspense } from "react";

import { Badge } from "@/components/badge";
import { buttonVariants } from "@/components/ui/button";
import { formatTarget } from "@/core/product-text";
import {
  groupByQuarter,
  loadRecentChanges,
  loadRoadmap,
  quarterOf,
} from "@/core/roadmap";
import { getDb } from "@/db/client";
import { projects } from "@/db/schema";

import { ChangeFeed } from "./change-feed";
import { OutcomeCard } from "./outcome-card";
import { ProjectNav } from "./project-nav";
import { RoadmapSummary } from "./roadmap-summary";

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
  // Inside Suspense the status is already 200, so this renders not-found.tsx with a noindex tag, not a 404.
  // A real 404 would need a Proxy check, and Proxy must not share the app's PGlite client.
  if (!project) notFound();

  const roadmap = await loadRoadmap(db, project.id);
  const changes = await loadRecentChanges(db, project.id, roadmap);
  const thisQuarter = quarterOf(new Date().toISOString().slice(0, 10));

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ProjectNav slug={slug} name={project.name} current="" />
      </div>

      {roadmap.length > 0 && <RoadmapSummary roadmap={roadmap} />}

      {/* Side by side only when the page itself is wide, whatever the window size. */}
      <div className="@container">
        <div className="grid gap-10 @4xl:grid-cols-[minmax(0,1fr)_20rem]">
          <section aria-labelledby="outcomes" className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="outcomes" className="text-xl font-semibold">
                Outcomes by target date
              </h2>
              <Link
                href={showDetail ? `/p/${slug}` : `/p/${slug}?detail=1`}
                scroll={false}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                {showDetail ? "Hide technical detail" : "Show technical detail"}
              </Link>
            </div>
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
              groupByQuarter(roadmap).map(({ quarter, outcomes }) => (
                <section
                  key={quarter ?? "none"}
                  aria-labelledby={`quarter-${quarter ?? "none"}`}
                  className="flex flex-col gap-3"
                >
                  <div className="flex items-center gap-3">
                    <h3
                      id={`quarter-${quarter ?? "none"}`}
                      className="text-base font-semibold"
                    >
                      {quarter ? formatTarget(quarter) : "No target date yet"}
                    </h3>
                    {quarter === thisQuarter && (
                      <Badge tone="blue">This quarter</Badge>
                    )}
                    <span aria-hidden className="h-px flex-1 bg-border" />
                  </div>
                  <ul className="flex flex-col gap-4">
                    {outcomes.map((outcome) => (
                      <li key={outcome.id}>
                        <OutcomeCard
                          outcome={outcome}
                          showDetail={showDetail}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            )}
          </section>

          <ChangeFeed changes={changes} showDetail={showDetail} />
        </div>
      </div>
    </>
  );
}
