"use client";
/** Tabs linking a project's pages, marking the one being shown. Exports ProjectNav. */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactElement, useEffect, useRef } from "react";

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
 * One row of tabs for the project's pages; it scrolls sideways when the screen is narrow.
 *
 * Args:
 *   slug: The project slug.
 *   name: The project name, used to label the navigation.
 *   pending: How many proposals wait in the review queue.
 *
 * Returns:
 *   The navigation.
 */
export function ProjectNav({
  slug,
  name,
  pending,
}: {
  slug: string;
  name: string;
  pending: number;
}): ReactElement {
  // The layout stays mounted between pages, so the current tab comes from the address, not a prop.
  const current = usePathname().slice(`/p/${slug}`.length);
  const currentLink = useRef<HTMLAnchorElement>(null);

  // On a phone, later tabs such as Settings start off-screen; bring the current one into view.
  useEffect(() => {
    currentLink.current?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [current]);

  // "relative" keeps the absolutely positioned sr-only text inside the scrolling row; without it,
  // that text stretches the whole page sideways on a phone.
  return (
    <nav
      aria-label={`${name} pages`}
      className="relative -mx-4 overflow-x-auto px-4 [scrollbar-width:none]"
    >
      <ul className="flex">
        {VIEWS.map((view) => (
          <li key={view.path}>
            <Link
              ref={view.path === current ? currentLink : undefined}
              href={`/p/${slug}${view.path}`}
              aria-current={view.path === current ? "page" : undefined}
              className="flex h-11 items-center gap-1.5 border-b-2 border-transparent px-3 text-sm whitespace-nowrap text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary aria-[current=page]:border-foreground aria-[current=page]:font-medium aria-[current=page]:text-foreground"
            >
              {view.label}
              {/* The space keeps "Review queue 5 waiting" apart for screen readers. */}{" "}
              {view.path === "/review" && pending > 0 && (
                <span className="rounded-full bg-primary px-1.5 text-xs leading-5 font-medium text-primary-foreground tabular-nums">
                  {pending}
                  <span className="sr-only"> waiting</span>
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
