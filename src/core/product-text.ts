/** Plain-language wording shared by the product view and the weekly digest. Exports PRODUCT_STATUS_TEXT, formatTarget. */
import type { ProductStatus } from "./rollup";

/** A short label and a one-sentence explanation for each product status. */
export const PRODUCT_STATUS_TEXT: Record<
  ProductStatus,
  { label: string; summary: string }
> = {
  not_started: {
    label: "Not started",
    summary: "Work on this has not started yet.",
  },
  in_progress: {
    label: "In progress",
    summary: "Work is under way, but customers cannot use any of it yet.",
  },
  partially_available: {
    label: "Partially available",
    summary: "Customers can use part of this today.",
  },
  delivered: {
    label: "Delivered",
    summary: "Customers can use all of this today.",
  },
};

/**
 * Format a target as written in the roadmap ("2026-Q4" or "2027-01-11") for reading.
 *
 * Args:
 *   target: A quarter or an ISO date; anything else is shown as it is.
 *
 * Returns:
 *   E.g. "Q4 2026" or "11 January 2027".
 */
export function formatTarget(target: string): string {
  const quarter = /^(\d{4})-Q([1-4])$/.exec(target);
  if (quarter) return `Q${quarter[2]} ${quarter[1]}`;
  const date = new Date(`${target}T00:00:00Z`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(target) && !isNaN(date.getTime())) {
    return date.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
  }
  return target;
}
