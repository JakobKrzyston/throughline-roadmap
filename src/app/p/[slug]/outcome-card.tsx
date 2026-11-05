/** One product outcome in plain language: status, target, progress, what customers can use and what is still to come. Exports OutcomeCard, StatusProgressBar, STATUS_TONE, STATUS_COLOUR. */
import {
  CalendarDays,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  TriangleAlert,
} from "lucide-react";
import type { ReactElement } from "react";

import { Badge, type BadgeTone } from "@/components/badge";
import { formatTarget, PRODUCT_STATUS_TEXT } from "@/core/product-text";
import { availableToday, type OutcomeTree, stillToCome } from "@/core/roadmap";
import {
  outcomeProgress,
  type ProductStatus,
  productStatus,
} from "@/core/rollup";
import { lateRequirements } from "@/core/schedule";

/** The badge tone for each product status. */
export const STATUS_TONE: Record<ProductStatus, BadgeTone> = {
  not_started: "neutral",
  in_progress: "amber",
  partially_available: "blue",
  delivered: "green",
};

/** A solid fill in each status's colour, for progress bars and the summary's markers. */
export const STATUS_COLOUR: Record<ProductStatus, string> = {
  not_started: "bg-neutral-400 dark:bg-neutral-500",
  in_progress: "bg-amber-500 dark:bg-amber-400",
  partially_available: "bg-sky-600 dark:bg-sky-400",
  delivered: "bg-emerald-600 dark:bg-emerald-400",
};

/**
 * A progress bar filled in the colour of a product status.
 *
 * Args:
 *   label: The bar's accessible name.
 *   percent: How much is done, from 0 to 100.
 *   status: The product status that sets the fill colour.
 *   className: Extra layout classes for the bar, such as flex-1.
 *
 * Returns:
 *   The progress bar.
 */
export function StatusProgressBar({
  label,
  percent,
  status,
  className = "",
}: {
  label: string;
  percent: number;
  status: ProductStatus;
  className?: string;
}): ReactElement {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className={`h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700 ${className}`}
    >
      <div
        className={`h-full ${STATUS_COLOUR[status]}`}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
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
  const statusKey = productStatus(outcome.requirements);
  const status = PRODUCT_STATUS_TEXT[statusKey];
  const percent = Math.round(outcomeProgress(outcome.requirements) * 100);
  const available = availableToday(outcome.requirements);
  const coming = stillToCome(outcome.requirements);
  const late = lateRequirements(outcome.target, outcome.requirements);
  const titleId = `outcome-${outcome.id}`;

  return (
    <article
      aria-labelledby={titleId}
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5 text-card-foreground"
    >
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h4 id={titleId} className="text-lg font-semibold">
            {outcome.title}
            {showDetail && (
              <span className="ml-2 font-mono text-sm font-normal text-muted-foreground">
                {outcome.key}
              </span>
            )}
          </h4>
          <Badge tone={STATUS_TONE[statusKey]}>{status.label}</Badge>
        </div>
        {outcome.description && (
          <p className="text-muted-foreground">{outcome.description}</p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
          <span className="flex items-center gap-1.5 font-medium">
            <CalendarDays aria-hidden className="size-4" />
            {outcome.target
              ? `Target ${formatTarget(outcome.target)}`
              : "No target date yet"}
          </span>
          <span className="text-muted-foreground">{percent}% done</span>
        </div>
        <StatusProgressBar
          label={`Progress on ${outcome.title}`}
          percent={percent}
          status={statusKey}
        />
        {late.length > 0 && (
          <p className="flex items-start gap-1.5 text-sm text-amber-900 dark:text-amber-300">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>
              Some of the remaining work is planned after this date, so it may
              move.
              {showDetail && (
                <span className="ml-2 font-mono text-muted-foreground">
                  {late.map((r) => r.key).join(", ")}
                </span>
              )}
            </span>
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <p>
          {outcome.requirements.length === 0
            ? "No work has been planned for this yet."
            : status.summary}
        </p>
        {available.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {available.map((item) => (
              <li key={item.key} className="flex items-start gap-2">
                <CircleCheck
                  aria-hidden
                  className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                />
                <span>
                  {item.text}
                  {showDetail && (
                    <span className="ml-2 font-mono text-sm text-muted-foreground">
                      {item.key}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {coming.length > 0 && (
        <details className="group border-t border-border pt-3">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
            <ChevronRight
              aria-hidden
              className="size-4 transition-transform group-open:rotate-90"
            />
            Still to come ({coming.length})
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5 pl-1">
            {coming.map((item) => (
              <li key={item.key} className="flex items-start gap-2">
                <CircleDashed
                  aria-hidden
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                />
                <span>
                  {item.text}
                  {showDetail && (
                    <span className="ml-2 font-mono text-sm text-muted-foreground">
                      {item.key}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}
