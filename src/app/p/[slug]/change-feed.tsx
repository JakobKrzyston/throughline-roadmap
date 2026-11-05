/** "What changed this week": recent changes grouped by day, each marked with its kind. Exports ChangeFeed. */
import {
  Ban,
  CalendarClock,
  CircleCheck,
  type LucideIcon,
  Pencil,
  Plus,
  Split,
} from "lucide-react";
import type { ReactElement } from "react";

import { Badge, type BadgeTone } from "@/components/badge";
import { type ChangeKind, groupByDay, type RecentChange } from "@/core/roadmap";

// An icon as well as a colour, so the kinds differ without relying on colour alone.
const KINDS: Record<
  ChangeKind,
  { label: string; tone: BadgeTone; icon: LucideIcon }
> = {
  shipped: { label: "Shipped", tone: "green", icon: CircleCheck },
  dropped: { label: "Dropped", tone: "neutral", icon: Ban },
  replanned: { label: "Replanned", tone: "amber", icon: CalendarClock },
  split: { label: "Split", tone: "purple", icon: Split },
  added: { label: "Added", tone: "blue", icon: Plus },
  updated: { label: "Updated", tone: "neutral", icon: Pencil },
};

/**
 * The change feed, one heading per day.
 *
 * Args:
 *   changes: Recent changes, newest first.
 *   showDetail: Whether to show the outcome or requirement key on each change.
 *
 * Returns:
 *   The feed section.
 */
export function ChangeFeed({
  changes,
  showDetail,
}: {
  changes: RecentChange[];
  showDetail: boolean;
}): ReactElement {
  return (
    <section aria-labelledby="changes" className="flex flex-col gap-4">
      <h2 id="changes" className="text-xl font-semibold">
        What changed this week
      </h2>
      {changes.length === 0 ? (
        <p className="text-muted-foreground">
          Nothing changed this week. Changes appear here when work is finished
          or plans change.
        </p>
      ) : (
        <ol className="flex flex-col gap-6">
          {groupByDay(changes).map(({ day, changes: entries }) => (
            <li key={day} className="flex flex-col gap-3">
              <h3 className="text-sm font-medium text-muted-foreground">
                <time dateTime={day}>
                  {new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    timeZone: "UTC",
                  })}
                </time>
              </h3>
              <ul className="flex flex-col gap-4">
                {entries.map((change) => {
                  const kind = KINDS[change.kind];
                  const Icon = kind.icon;
                  return (
                    <li key={change.id} className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <Badge tone={kind.tone}>
                          <Icon aria-hidden className="mr-1 size-3" />
                          {kind.label}
                        </Badge>
                        <span className="text-sm text-muted-foreground">
                          {change.outcomeTitle}
                          {showDetail && (
                            <span className="ml-2 font-mono">
                              {change.entityKey}
                            </span>
                          )}
                        </span>
                      </div>
                      <p>{change.note}</p>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
