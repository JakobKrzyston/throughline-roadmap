/** One product outcome in plain language: status, progress, what customers can use, and target. Exports OutcomeCard. */
import type { ReactElement } from "react";

import { Badge, type BadgeTone } from "@/components/badge";
import { availableToday, type OutcomeTree } from "@/core/roadmap";
import {
  outcomeProgress,
  type ProductStatus,
  productStatus,
} from "@/core/rollup";

const STATUS_TEXT: Record<
  ProductStatus,
  { label: string; tone: BadgeTone; summary: string }
> = {
  not_started: {
    label: "Not started",
    tone: "neutral",
    summary: "Work on this has not started yet.",
  },
  in_progress: {
    label: "In progress",
    tone: "amber",
    summary: "Work is under way, but customers cannot use any of it yet.",
  },
  partially_available: {
    label: "Partially available",
    tone: "blue",
    summary: "Customers can use part of this today.",
  },
  delivered: {
    label: "Delivered",
    tone: "green",
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
function formatTarget(target: string): string {
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

/**
 * A card for one outcome in the product view.
 *
 * Args:
 *   outcome: The outcome and its requirement tree.
 *   showDetail: Whether to show requirement keys, which are hidden by default.
 *
 * Returns:
 *   The card.
 */
export function OutcomeCard({
  outcome,
  showDetail,
}: {
  outcome: OutcomeTree;
  showDetail: boolean;
}): ReactElement {
  const status = STATUS_TEXT[productStatus(outcome.requirements)];
  const percent = Math.round(outcomeProgress(outcome.requirements) * 100);
  const available = availableToday(outcome.requirements);
  const titleId = `outcome-${outcome.id}`;

  return (
    <article
      aria-labelledby={titleId}
      className="flex flex-col gap-3 rounded-lg border border-border p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 id={titleId} className="text-lg font-semibold">
          {outcome.title}
          {showDetail && (
            <span className="ml-2 font-mono text-sm font-normal text-muted-foreground">
              {outcome.key}
            </span>
          )}
        </h3>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>
      {outcome.description && (
        <p className="text-muted-foreground">{outcome.description}</p>
      )}

      <div className="flex items-center gap-3">
        <div
          role="progressbar"
          aria-label={`Progress on ${outcome.title}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-200"
        >
          <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
        </div>
        <span className="text-sm text-muted-foreground">{percent}% done</span>
      </div>

      {outcome.requirements.length === 0 ? (
        <p>No work has been planned for this yet.</p>
      ) : (
        <p>{status.summary}</p>
      )}
      {available.length > 0 && (
        <ul className="list-disc pl-5">
          {available.map((item) => (
            <li key={item.key}>
              {item.text}
              {showDetail && (
                <span className="ml-2 font-mono text-sm text-muted-foreground">
                  {item.key}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="text-sm text-muted-foreground">
        {outcome.target
          ? `Target: ${formatTarget(outcome.target)}`
          : "No target date yet"}
      </p>
    </article>
  );
}
