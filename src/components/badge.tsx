/** A small coloured status label. Exports Badge. */
import type { ReactElement, ReactNode } from "react";

// Each pair keeps text at WCAG AA contrast (4.5:1 or better) on its background, in both themes.
const TONES = {
  neutral:
    "bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200",
  green:
    "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  blue: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  amber: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  purple:
    "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200",
} as const;

export type BadgeTone = keyof typeof TONES;

/**
 * A rounded label for a status, e.g. "Delivered" or "Merged".
 *
 * Args:
 *   tone: Colour of the label.
 *   children: The label text.
 *
 * Returns:
 *   The badge.
 */
export function Badge({
  tone,
  children,
}: {
  tone: BadgeTone;
  children: ReactNode;
}): ReactElement {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}
