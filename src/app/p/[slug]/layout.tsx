/** The shell around every project page: the top bar and the page title template. Exports the layout and generateMetadata. */
import { and, count, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { cache, type ReactElement, Suspense } from "react";

import { Skeleton } from "@/components/skeleton";
import { ThemeControl } from "@/components/theme-control";
import { getDb } from "@/db/client";
import { projects, proposals } from "@/db/schema";

import { ProjectNav } from "./project-nav";

// The title, the project name and the tabs all need the project; cache() reads it once per request.
const loadProject = cache(async (slug: string) => {
  // The database read is uncached, so render it per request rather than prerendering it.
  await connection();
  const db = getDb();
  const [project] = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(eq(projects.slug, slug));
  if (!project) return undefined;
  const [{ pending }] = await db
    .select({ pending: count() })
    .from(proposals)
    .where(
      and(eq(proposals.projectId, project.id), eq(proposals.status, "pending")),
    );
  return { name: project.name, pending };
});

const SEPARATOR = (
  <span aria-hidden className="text-muted-foreground">
    /
  </span>
);

/**
 * Title template for the project's pages, e.g. "Review queue · Acme Analytics · Throughline".
 *
 * Args:
 *   params: Route params holding the project slug.
 *
 * Returns:
 *   The metadata.
 */
export async function generateMetadata({
  params,
}: LayoutProps<"/p/[slug]">): Promise<Metadata> {
  const project = await loadProject((await params).slug);
  if (!project)
    return { title: { template: "%s · Throughline", default: "Throughline" } };
  const site = `${project.name} · Throughline`;
  return {
    title: {
      template: `%s · ${site}`,
      // A template does not apply to a page in its own segment, so the product view (this
      // segment's page) gets its title here; every other page sets its own.
      default: `Product roadmap · ${site}`,
    },
  };
}

/**
 * Top bar with the brand, project name, theme control and page tabs, above the page.
 *
 * Args:
 *   children: The page.
 *   params: Route params holding the project slug.
 *
 * Returns:
 *   The shell.
 */
export default function ProjectLayout({
  children,
  params,
}: LayoutProps<"/p/[slug]">): ReactElement {
  return (
    <>
      <header className="border-b border-border">
        <div className="mx-auto w-full max-w-5xl px-4">
          <div className="flex h-14 items-center gap-2">
            <Link
              href="/"
              className="shrink-0 rounded-sm font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              Throughline
            </Link>
            <Suspense
              fallback={
                <>
                  {SEPARATOR}
                  <Skeleton className="h-5 w-32" />
                </>
              }
            >
              <ProjectName params={params} />
            </Suspense>
            <div className="ml-auto">
              <ThemeControl />
            </div>
          </div>
          <Suspense fallback={<NavSkeleton />}>
            <ProjectTabs params={params} />
          </Suspense>
        </div>
      </header>
      {children}
    </>
  );
}

async function ProjectName({
  params,
}: Pick<LayoutProps<"/p/[slug]">, "params">): Promise<ReactElement | null> {
  const project = await loadProject((await params).slug);
  // An unknown project has no name to show; the page itself renders not-found.tsx below.
  if (!project) return null;
  return (
    <>
      {SEPARATOR}
      <span className="min-w-0 truncate font-medium">{project.name}</span>
    </>
  );
}

async function ProjectTabs({
  params,
}: Pick<LayoutProps<"/p/[slug]">, "params">): Promise<ReactElement | null> {
  const { slug } = await params;
  const project = await loadProject(slug);
  if (!project) return null;
  return (
    <ProjectNav slug={slug} name={project.name} pending={project.pending} />
  );
}

function NavSkeleton(): ReactElement {
  return (
    <div className="flex h-11 items-center gap-6 overflow-hidden px-3">
      {["w-22", "w-26", "w-8", "w-16", "w-24", "w-12", "w-14"].map((width) => (
        <Skeleton key={width} className={`h-4 shrink-0 ${width}`} />
      ))}
    </div>
  );
}
