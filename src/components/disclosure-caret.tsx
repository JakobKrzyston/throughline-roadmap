/** A caret for a `<details>` row that turns when the row opens, and the summary style that goes with it. Exports DisclosureCaret, SUMMARY_CLASS, WHEN_CLOSED_CLASS. */
import { ChevronRight } from "lucide-react";
import type { ReactElement } from "react";

/**
 * Hides the browser's own marker on a summary, which a flex or grid summary hides in Chrome but
 * not in Safari, so DisclosureCaret is the only marker everywhere. Add a flex or grid layout.
 */
export const SUMMARY_CLASS =
  "cursor-pointer list-none rounded-sm py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden";

// The variants below match only the nearest details, so an open parent leaves its closed
// children's carets and hints alone. Tailwind reads class names literally, so they are spelled out.

/** Hides a summary's hint about what a closed row holds once the row is open. */
export const WHEN_CLOSED_CLASS = "[details[open]>summary_&]:hidden";

/**
 * A right-pointing caret that points down while its `<details>` is open. Put it inside the
 * `<summary>` of a summary styled with SUMMARY_CLASS.
 *
 * Returns:
 *   The caret, hidden from assistive technology, which already announces the open state.
 */
export function DisclosureCaret(): ReactElement {
  return (
    <ChevronRight
      aria-hidden
      className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none [details[open]>summary_&]:rotate-90"
    />
  );
}
