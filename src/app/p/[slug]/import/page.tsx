/** /p/[slug]/import: paste, upload or read a roadmap from Linear, and turn it into a proposal for the review queue. */
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { type ReactElement, Suspense } from "react";

import { demoModels, isDemoLLM } from "@/adapters/llm";
import { IMPORT_SAMPLES } from "@/agents/import-samples";
import { FormSkeleton } from "@/components/skeleton";
import { getDb } from "@/db/client";
import { projects } from "@/db/schema";
import { isPublicDeployment, isViewOnly } from "@/lib/public-deployment";

import { ViewOnlyNotice } from "../view-only-notice";
import { ImportModes } from "./import-modes";
import { LinearImport } from "./linear-import";

// Up to two model calls run in this page's server action; allow them more than the platform default.
export const maxDuration = 300;

export const metadata = { title: "Import a roadmap" };

/**
 * Import page: a static heading plus the import form for the project in the URL.
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
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          Import a roadmap
        </h1>
        <p className="text-muted-foreground">
          Paste a roadmap, upload an export from the tool you plan in, or read
          it straight from Linear, and Throughline drafts its product outcomes
          and technical requirements as a proposal. Teams that keep a product
          roadmap and a technical roadmap can bring both together. Nothing
          changes until you approve it in the review queue.
        </p>
      </div>
      {/* The project lookup runs per request; the heading above is the static shell. */}
      <Suspense fallback={<FormSkeleton />}>
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
      {isViewOnly(project) ? (
        <ViewOnlyNotice />
      ) : (
        <>
          {isPublicDeployment() && demoModels() ? (
            <p className="rounded-md border border-border bg-muted p-3 text-sm">
              This demo uses free models through OpenRouter (
              {demoModels()!.join(", then ")}). When they are busy or answer
              badly, you get a sample proposal instead.
            </p>
          ) : (
            (isDemoLLM() || isPublicDeployment()) && (
              <p className="rounded-md border border-border bg-muted p-3 text-sm">
                Demo mode: each sample export gets a proposal written for it,
                and anything else you paste or upload gets the same sample
                proposal. A product and a technical roadmap can be imported
                together only as their sample.
              </p>
            )
          )}
          <ImportModes
            slug={slug}
            // Only the buttons; a sample's text is fetched when its button is clicked.
            samples={IMPORT_SAMPLES.map(({ id, label }) => ({ id, label }))}
          />
          <LinearImport slug={slug} isDemo={project.isDemo} />
        </>
      )}
    </>
  );
}
