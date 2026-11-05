/** Throughline's mark: one line threading through three layers of a roadmap. Exports LogoMark. */
import type { ReactElement } from "react";

/**
 * The mark, drawn in the current text colour.
 *
 * Args:
 *   size: Width and height in pixels.
 *
 * Returns:
 *   A decorative SVG; pair it with the product name.
 */
export function LogoMark({ size = 28 }: { size?: number }): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      aria-hidden="true"
    >
      {/* Outcomes, requirements and pull requests, joined by one line. */}
      <path d="M5 8h22M5 16h22M5 24h22" strokeWidth="2" opacity="0.35" />
      <path d="M9 8l7 8 7 8" strokeWidth="3" />
      <circle cx="9" cy="8" r="3" fill="currentColor" stroke="none" />
      <circle cx="16" cy="16" r="3" fill="currentColor" stroke="none" />
      <circle cx="23" cy="24" r="3" fill="currentColor" stroke="none" />
    </svg>
  );
}
