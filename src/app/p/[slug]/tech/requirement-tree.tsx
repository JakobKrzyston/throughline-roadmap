/** The technical view's expandable requirement tree, with linked issues and pull requests and who is working on them. Exports RequirementList, RowSummary, RollupBadge, Tag. */
import {
  CalendarDays,
  CircleDot,
  Eye,
  GitPullRequest,
  TriangleAlert,
  Users,
} from "lucide-react";
import type { ReactElement, ReactNode } from "react";

import { Badge, type BadgeTone } from "@/components/badge";
import { SourceLink } from "@/components/source-link";
import type { LeafStatus } from "@/core/operations";
import { formatTarget } from "@/core/product-text";
import type { LinkedWorkItem, RequirementTree } from "@/core/roadmap";
import {
  outcomeProgress,
  type RequirementNode,
  rolledUpStatus,
} from "@/core/rollup";
import { WORK_TYPE_LABELS } from "@/core/operations";

import {
  DisclosureCaret,
  SUMMARY_CLASS,
  WHEN_CLOSED_CLASS,
} from "./disclosure-caret";

// Leaves and rolled-up rows share these, so "Done" and "100% done" are the same colour.
const STATUS_TONE: Record<LeafStatus, BadgeTone> = {
  planned: "neutral",
  in_progress: "amber",
  done: "green",
  dropped: "neutral",
};

const STATUS_LABEL: Record<LeafStatus, string> = {
  planned: "Planned",
  in_progress: "In progress",
  done: "Done",
  dropped: "Dropped",
};

const WORK_ITEM_STATE: Record<
  LinkedWorkItem["state"],
  { label: string; tone: BadgeTone }
> = {
  open: { label: "Open", tone: "green" },
  merged: { label: "Merged", tone: "purple" },
  closed: { label: "Closed", tone: "neutral" },
  not_planned: { label: "Not planned", tone: "neutral" },
};

/**
 * Progress of a parent requirement or an outcome, e.g. "60% done", coloured like a leaf in
 * the same state.
 *
 * Args:
 *   requirements: The parent alone, or an outcome's root requirements.
 *
 * Returns:
 *   The badge.
 */
export function RollupBadge({
  requirements,
}: {
  requirements: RequirementNode[];
}): ReactElement {
  const status = rolledUpStatus(requirements);
  return (
    <Badge tone={STATUS_TONE[status]}>
      {status === "dropped"
        ? STATUS_LABEL.dropped
        : `${Math.round(outcomeProgress(requirements) * 100)}% done`}
    </Badge>
  );
}

/**
 * An outlined label for a fact about a row, such as its team or due date, kept apart from the
 * filled status badges.
 *
 * Args:
 *   icon: An optional lucide icon shown before the text.
 *   className: Extra classes, e.g. a warning colour.
 *   children: The label text.
 *
 * Returns:
 *   The label.
 */
export function Tag({
  icon: Icon,
  className = "border-border text-muted-foreground",
  children,
}: {
  icon?: typeof Users;
  className?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <span
      className={`inline-flex max-w-full shrink-0 items-center gap-1 rounded-md border px-1.5 py-px text-xs ${className}`}
    >
      {Icon && <Icon aria-hidden className="size-3" />}
      {children}
    </span>
  );
}

/**
 * The `<summary>` of an outcome or requirement row: caret, key and title, labels, a hint at what
 * the closed row holds, and its status badge on the right.
 *
 * Args:
 *   rowKey: The outcome or requirement key, e.g. "TL-3".
 *   title: The title, styled by the caller.
 *   status: The status badge.
 *   hint: What the row holds, shown only while it is closed.
 *   children: Labels such as Tag, shown after the title.
 *
 * Returns:
 *   The summary.
 */
export function RowSummary({
  rowKey,
  title,
  status,
  hint,
  children,
}: {
  rowKey: string;
  title: ReactNode;
  status: ReactNode;
  hint: ReactNode;
  children: ReactNode;
}): ReactElement {
  return (
    // On a phone the labels take their own line, running under the badge as well as the title;
    // from sm up they follow the title. `contents` lets the title and labels sit in the grid.
    <summary
      className={`${SUMMARY_CLASS} grid grid-cols-[auto_1fr_auto] items-start gap-x-2 gap-y-1`}
    >
      <DisclosureCaret />
      <div className="contents sm:col-start-2 sm:row-start-1 sm:flex sm:min-w-0 sm:flex-wrap sm:items-center sm:gap-x-2 sm:gap-y-1">
        <span className="col-start-2 row-start-1 min-w-0">
          <span className="mr-1.5 font-mono text-xs text-muted-foreground">
            {rowKey}
          </span>
          {title}
        </span>
        <span className="col-span-2 col-start-2 row-start-2 flex flex-wrap items-center gap-1.5 empty:hidden">
          {children}
          <span
            className={`flex items-center gap-2 text-xs text-muted-foreground ${WHEN_CLOSED_CLASS}`}
          >
            {hint}
          </span>
        </span>
      </div>
      <span className="col-start-3 row-start-1 pt-0.5">{status}</span>
    </summary>
  );
}

/**
 * A list of requirements, each expandable to show its children and linked work.
 *
 * Args:
 *   requirements: Requirements at one level of the tree.
 *   lateKeys: Keys of unfinished requirements due after their outcome's target.
 *   shown: Keys of the requirements a filter leaves in, or null to show every one.
 *   sample: True for a demo project, whose work items have no real GitHub page.
 *
 * Returns:
 *   The nested list.
 */
export function RequirementList({
  requirements,
  lateKeys,
  shown,
  sample,
}: {
  requirements: RequirementTree[];
  lateKeys: Set<string>;
  shown: Set<string> | null;
  sample: boolean;
}): ReactElement {
  return (
    // The rule sits under the parent's caret; the indent stays small so deep rows fit on a phone.
    <ul className="ml-2 flex flex-col border-l border-border pl-2 sm:pl-3">
      {requirements
        .filter((requirement) => !shown || shown.has(requirement.key))
        .map((requirement) => (
          <li key={requirement.id}>
            <RequirementItem
              requirement={requirement}
              lateKeys={lateKeys}
              shown={shown}
              sample={sample}
            />
          </li>
        ))}
    </ul>
  );
}

function RequirementItem({
  requirement,
  lateKeys,
  shown,
  sample,
}: {
  requirement: RequirementTree;
  lateKeys: Set<string>;
  shown: Set<string> | null;
  sample: boolean;
}): ReactElement {
  const isParent = requirement.children.length > 0;
  const dropped = requirement.status === "dropped";

  return (
    // Parents start open so the tree reads at a glance; leaves open to show their work items.
    <details open={isParent}>
      <RowSummary
        rowKey={requirement.key}
        title={
          <span
            className={
              dropped ? "text-muted-foreground line-through" : "font-medium"
            }
          >
            {requirement.title}
          </span>
        }
        status={
          requirement.status ? (
            <Badge tone={STATUS_TONE[requirement.status]}>
              {STATUS_LABEL[requirement.status]}
            </Badge>
          ) : (
            <RollupBadge requirements={[requirement]} />
          )
        }
        hint={
          isParent ? (
            `Split into ${requirement.children.length}`
          ) : (
            <LinkedWorkHint items={requirement.workItems} />
          )
        }
      >
        {requirement.workType && (
          <Tag>{WORK_TYPE_LABELS[requirement.workType]}</Tag>
        )}
        {/* An inherited team is the parent's, which is shown on the parent's row. */}
        {requirement.team && !requirement.teamInherited && (
          <Tag icon={Users}>{requirement.team}</Tag>
        )}
        {requirement.userVisible && <Tag icon={Eye}>Customer-facing</Tag>}
        {requirement.target && (
          <Tag icon={CalendarDays}>Due {formatTarget(requirement.target)}</Tag>
        )}
        {lateKeys.has(requirement.key) && (
          <Tag
            icon={TriangleAlert}
            className="border-amber-300 text-amber-800 dark:border-amber-700 dark:text-amber-300"
          >
            After the outcome&rsquo;s target
          </Tag>
        )}
      </RowSummary>
      <div className="flex flex-col gap-2 pb-2 pl-6 text-sm">
        {requirement.description && (
          <p className="text-muted-foreground">{requirement.description}</p>
        )}
        {requirement.splitReason && (
          <p>
            <span className="font-medium">Split: </span>
            {requirement.splitReason}
          </p>
        )}
        {requirement.people.length > 0 && (
          <p>
            {/* Everyone on its linked work, finished or not: the people to ask about it. */}
            <span className="font-medium">People: </span>
            {requirement.people.join(", ")}
          </p>
        )}
        {!isParent &&
          (requirement.workItems.length === 0 ? (
            <p className="text-muted-foreground">
              No issues or pull requests linked yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {requirement.workItems.map((item) => (
                <WorkItemRow key={item.id} item={item} sample={sample} />
              ))}
            </ul>
          ))}
        {isParent &&
          shown &&
          !requirement.children.some((child) => shown.has(child.key)) && (
            <p className="text-muted-foreground">
              None of its pieces match the filter.
            </p>
          )}
      </div>
      {isParent && (
        <RequirementList
          requirements={requirement.children}
          lateKeys={lateKeys}
          shown={shown}
          sample={sample}
        />
      )}
    </details>
  );
}

/** What a closed leaf holds, as an icon and a count per kind; the words are for screen readers. */
function LinkedWorkHint({ items }: { items: LinkedWorkItem[] }): ReactNode {
  if (items.length === 0) return "Nothing linked";
  const kinds = [
    { kind: "issue", Icon: CircleDot, one: "issue", many: "issues" },
    {
      kind: "pull_request",
      Icon: GitPullRequest,
      one: "pull request",
      many: "pull requests",
    },
  ] as const;
  return kinds.map(({ kind, Icon, one, many }) => {
    const n = items.filter((item) => item.kind === kind).length;
    if (n === 0) return null;
    const words = `${n} ${n === 1 ? one : many}`;
    return (
      <span
        key={kind}
        title={words}
        className="inline-flex items-center gap-0.5"
      >
        <Icon aria-hidden className="size-3" />
        {n}
        <span className="sr-only"> {n === 1 ? one : many}</span>
      </span>
    );
  });
}

function WorkItemRow({
  item,
  sample,
}: {
  item: LinkedWorkItem;
  sample: boolean;
}): ReactElement {
  const state = WORK_ITEM_STATE[item.state];
  const Icon = item.kind === "pull_request" ? GitPullRequest : CircleDot;
  return (
    <li className="flex items-start gap-2">
      <Icon
        aria-hidden
        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
      />
      <span className="min-w-0 flex-1">
        <SourceLink
          href={item.url}
          sample={sample}
          className="rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {item.title}
        </SourceLink>
        <span className="ml-1.5 text-xs whitespace-nowrap text-muted-foreground">
          {item.kind === "pull_request" ? "PR" : "Issue"} #{item.number}
          {item.confidence === "suggested" && " · Suggested link"}
        </span>
      </span>
      <span className="shrink-0">
        <Badge tone={state.tone}>{state.label}</Badge>
      </span>
    </li>
  );
}
