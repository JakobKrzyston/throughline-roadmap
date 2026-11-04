/** The technical view's expandable requirement tree, with linked issues and pull requests and who is working on them. Exports RequirementList, SUMMARY_CLASS. */
import type { ReactElement } from "react";

import { Badge, type BadgeTone } from "@/components/badge";
import { WORK_TYPE_LABELS } from "@/core/proposal-diff";
import type { LinkedWorkItem, RequirementTree } from "@/core/roadmap";
import { requirementProgress } from "@/core/rollup";
import { formatTarget } from "@/core/product-text";

const LEAF_STATUS: Record<
  NonNullable<RequirementTree["status"]>,
  { label: string; tone: BadgeTone }
> = {
  planned: { label: "Planned", tone: "neutral" },
  in_progress: { label: "In progress", tone: "amber" },
  done: { label: "Done", tone: "green" },
  dropped: { label: "Dropped", tone: "neutral" },
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

export const SUMMARY_CLASS =
  "flex cursor-pointer flex-wrap items-center gap-2 rounded-sm py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

/**
 * A list of requirements, each expandable to show its children and linked work.
 *
 * Args:
 *   requirements: Requirements at one level of the tree.
 *   lateKeys: Keys of unfinished requirements due after their outcome's target.
 *   shown: Keys of the requirements a filter leaves in, or null to show every one.
 *
 * Returns:
 *   The nested list.
 */
export function RequirementList({
  requirements,
  lateKeys,
  shown,
}: {
  requirements: RequirementTree[];
  lateKeys: Set<string>;
  shown: Set<string> | null;
}): ReactElement {
  return (
    <ul className="flex flex-col gap-1 border-l border-border pl-4">
      {requirements
        .filter((requirement) => !shown || shown.has(requirement.key))
        .map((requirement) => (
          <li key={requirement.id}>
            <RequirementItem
              requirement={requirement}
              lateKeys={lateKeys}
              shown={shown}
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
}: {
  requirement: RequirementTree;
  lateKeys: Set<string>;
  shown: Set<string> | null;
}): ReactElement {
  const isParent = requirement.children.length > 0;
  const status = requirement.status ? LEAF_STATUS[requirement.status] : null;

  return (
    // Parents start open so the tree reads at a glance; leaves open to show their work items.
    <details open={isParent}>
      <summary className={SUMMARY_CLASS}>
        <span className="font-mono text-sm text-muted-foreground">
          {requirement.key}
        </span>
        <span className="font-medium">{requirement.title}</span>
        {status ? (
          <Badge tone={status.tone}>{status.label}</Badge>
        ) : (
          <Badge tone="blue">
            {Math.round(requirementProgress(requirement) * 100)}% done
          </Badge>
        )}
        {requirement.workType && (
          <span className="text-xs text-muted-foreground">
            {WORK_TYPE_LABELS[requirement.workType]}
          </span>
        )}
        {/* An inherited team is the parent's, which is shown on the parent's row. */}
        {requirement.team && !requirement.teamInherited && (
          <span className="text-xs text-muted-foreground">
            Team {requirement.team}
          </span>
        )}
        {requirement.userVisible && (
          <span className="text-xs text-muted-foreground">Customer-facing</span>
        )}
        {requirement.target && (
          <span className="text-xs text-muted-foreground">
            Due {formatTarget(requirement.target)}
          </span>
        )}
        {lateKeys.has(requirement.key) && (
          <Badge tone="amber">After the outcome&rsquo;s target</Badge>
        )}
      </summary>
      <div className="flex flex-col gap-2 pb-2 pl-4">
        {requirement.description && (
          <p className="text-sm text-muted-foreground">
            {requirement.description}
          </p>
        )}
        {requirement.splitReason && (
          <p className="text-sm">
            <span className="font-medium">Split: </span>
            {requirement.splitReason}
          </p>
        )}
        {requirement.people.length > 0 && (
          <p className="text-sm">
            <span className="font-medium">Working on it: </span>
            {requirement.people.join(", ")}
          </p>
        )}
        {isParent ? (
          <RequirementList
            requirements={requirement.children}
            lateKeys={lateKeys}
            shown={shown}
          />
        ) : requirement.workItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No issues or pull requests linked yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {requirement.workItems.map((item) => (
              <WorkItemRow key={item.id} item={item} />
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

function WorkItemRow({ item }: { item: LinkedWorkItem }): ReactElement {
  const state = WORK_ITEM_STATE[item.state];
  return (
    <li className="flex flex-wrap items-center gap-2">
      <span className="text-muted-foreground">
        {item.kind === "pull_request" ? "PR" : "Issue"} #{item.number}
      </span>
      <a
        href={item.url}
        className="rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        {item.title}
      </a>
      <Badge tone={state.tone}>{state.label}</Badge>
      {item.confidence === "suggested" && (
        <span className="text-xs text-muted-foreground">Suggested link</span>
      )}
    </li>
  );
}
