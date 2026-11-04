/** /p/[slug]/import: paste a roadmap and turn it into a proposal for the review queue. */
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { type ReactElement, Suspense } from "react";

import { isDemoLLM } from "@/adapters/llm";
import { getDb } from "@/db/client";
import { projects } from "@/db/schema";
import { isPublicDeployment, isViewOnly } from "@/lib/public-deployment";

import { ViewOnlyNotice } from "../view-only-notice";
import { ImportForm } from "./import-form";

// Up to two model calls run in this page's server action; allow them more than the platform default.
export const maxDuration = 300;

/**
 * Import page: a static heading plus the paste form for the project in the URL.
 *
 * Args:
 *   params: Route params holding the project slug.
 *
 * Returns:
 *   The page.
 */
export default function ImportPage({
  params,
}: PageProps<"/p/[slug]/import">): ReactElement {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          Import a roadmap
        </h1>
        <p className="text-muted-foreground">
          Paste a roadmap and Throughline drafts its product outcomes and
          technical requirements as a proposal. Nothing changes until you
          approve it in the review queue.
        </p>
      </div>
      {/* The project lookup runs per request; the heading above is the static shell. */}
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <ProjectImport params={params} />
      </Suspense>
    </main>
  );
}

async function ProjectImport({
  params,
}: Pick<PageProps<"/p/[slug]/import">, "params">): Promise<ReactElement> {
  const { slug } = await params;
  // The database read is uncached, so render this part per request rather than prerendering it.
  await connection();
  const [project] = await getDb()
    .select({ name: projects.name, isDemo: projects.isDemo })
    .from(projects)
    .where(eq(projects.slug, slug));
  if (!project) notFound();

  return (
    <>
      <p className="text-sm text-muted-foreground">
        Project: <span className="font-medium">{project.name}</span>
      </p>
      {isViewOnly(project) ? (
        <ViewOnlyNotice />
      ) : (
        <>
          {(isDemoLLM() || isPublicDeployment()) && (
            <p className="rounded-md border border-border bg-muted p-3 text-sm">
              Demo mode: you will get a sample proposal whatever you paste.
            </p>
          )}
          <ImportForm slug={slug} />
        </>
      )}
    </>
  );
}
