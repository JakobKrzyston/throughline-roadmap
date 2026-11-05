/** A title linked to its issue or pull request, or plain text for demo data that has no real page. Exports SourceLink. */
import type { ReactElement, ReactNode } from "react";

/**
 * Link a work item or piece of feedback to where it lives, unless it is demo data.
 *
 * Demo projects are seeded with made-up GitHub URLs, so their titles render as text with a
 * "sample" hint instead of a link that would 404.
 *
 * Args:
 *   href: The item's URL on its source.
 *   sample: True when the item belongs to a demo project.
 *   className: Classes for the link.
 *   children: The item's title.
 *
 * Returns:
 *   The link, or the title and hint.
 */
export function SourceLink({
  href,
  sample,
  className,
  children,
}: {
  href: string;
  sample: boolean;
  className?: string;
  children: ReactNode;
}): ReactElement {
  if (!sample) {
    return (
      <a href={href} className={className}>
        {children}
      </a>
    );
  }
  return (
    <>
      {children}
      <span
        title="Sample data for the demo; there is no real GitHub page behind it."
        className="ml-1.5 rounded-sm border border-border px-1 text-xs font-normal text-muted-foreground"
      >
        sample
      </span>
    </>
  );
}
