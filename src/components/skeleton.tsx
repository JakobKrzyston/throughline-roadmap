/** Grey placeholders shown while a page's data loads. Exports Skeleton, CardsSkeleton, FormSkeleton and SectionsSkeleton. */
import type { ReactElement } from "react";

import { cn } from "@/lib/utils";

/**
 * One pulsing grey block.
 *
 * Args:
 *   className: Size and shape, e.g. "h-4 w-32".
 *
 * Returns:
 *   The block, hidden from screen readers.
 */
export function Skeleton({ className }: { className?: string }): ReactElement {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded-md bg-foreground/10", className)}
    />
  );
}

/**
 * A section heading over three cards, for pages made of cards or rows.
 *
 * Returns:
 *   The placeholder.
 */
export function CardsSkeleton(): ReactElement {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-4">
      <Skeleton className="h-7 w-48" />
      {Array.from({ length: 3 }, (_, i) => (
        <div
          key={i}
          className="flex flex-col gap-3 rounded-lg border border-border p-4"
        >
          <div className="flex items-center justify-between gap-4">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      ))}
    </div>
  );
}

/**
 * A label, a large text box and a button, for the import form.
 *
 * Returns:
 *   The placeholder.
 */
export function FormSkeleton(): ReactElement {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-4">
      <Skeleton className="h-4 w-20" />
      <Skeleton className="h-80 w-full" />
      <Skeleton className="h-8 w-36" />
    </div>
  );
}

/**
 * Three headed sections of text with a field each, for the settings page.
 *
 * Returns:
 *   The placeholder.
 */
export function SectionsSkeleton(): ReactElement {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-8">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="flex flex-col gap-3">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-9 w-full max-w-md" />
        </div>
      ))}
    </div>
  );
}
