/** The top of the product view: how many outcomes are in each status. Exports RoadmapSummary. */
import type { ReactElement } from "react";

import { PRODUCT_STATUS_TEXT } from "@/core/product-text";
import type { OutcomeTree } from "@/core/roadmap";
import { type ProductStatus, statusCounts } from "@/core/rollup";

import { STATUS_COLOUR } from "./outcome-card";

// Furthest along first, the order a reader asks "what can customers use?".
const ORDER: ProductStatus[] = [
  "delivered",
  "partially_available",
  "in_progress",
  "not_started",
];

/**
 * One tile per product status with the number of outcomes in it.
 *
 * Args:
 *   roadmap: The project's outcomes.
 *
 * Returns:
 *   The summary.
 */
export function RoadmapSummary({
  roadmap,
}: {
  roadmap: OutcomeTree[];
}): ReactElement {
  const counts = statusCounts(roadmap.map((outcome) => outcome.requirements));

  return (
    <section aria-label="Roadmap summary">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {ORDER.map((status) => (
          <div
            key={status}
            className="flex flex-col gap-1 rounded-lg border border-border bg-card p-4 text-card-foreground"
          >
            <dt className="flex items-center gap-2 text-sm text-muted-foreground">
              <span
                aria-hidden
                className={`size-2.5 shrink-0 rounded-full ${STATUS_COLOUR[status]}`}
              />
              {PRODUCT_STATUS_TEXT[status].label}
            </dt>
            <dd className="text-3xl font-semibold tabular-nums">
              {counts[status]}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
