/** Links between a project's views. Exports ProjectNav. */
import Link from "next/link";
import type { ReactElement } from "react";

const VIEWS = [
  { path: "", label: "Product view" },
  { path: "/tech", label: "Technical view" },
  { path: "/plan", label: "Plan" },
  { path: "/feedback", label: "Feedback" },
  { path: "/review", label: "Review queue" },
  { path: "/import", label: "Import" },
  { path: "/settings", label: "Settings" },
] as const;

/**
 * The project name and links to each of its pages.
 *
 * Args:
 *   slug: The project slug.
 *   name: The project name.
 *   current: The path of the page being shown, e.g. "/tech".
 *
 * Returns:
 *   The navigation bar.
 */
export function ProjectNav({
  slug,
  name,
  current,
}: {
  slug: string;
  name: string;
  current: (typeof VIEWS)[number]["path"];
}): ReactElement {
  return (
    <nav
      aria-label={`${name} pages`}
      className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm"
    >
      <span className="font-medium">{name}</span>
      {VIEWS.map((view) => (
        <Link
          key={view.path}
          href={`/p/${slug}${view.path}`}
          aria-current={view.path === current ? "page" : undefined}
          className="rounded-sm text-muted-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary aria-[current=page]:font-medium aria-[current=page]:text-foreground"
        >
          {view.label}
        </Link>
      ))}
    </nav>
  );
}
