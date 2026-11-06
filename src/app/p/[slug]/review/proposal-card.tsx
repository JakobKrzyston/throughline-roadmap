"use client";
/** One pending proposal in the review queue: summary, rationale, readable diff or import mapping, and approve / edit / reject. Exports ProposalCard, ProposalView. */
import { type MouseEvent, type ReactElement, useState } from "react";
import { useFormStatus } from "react-dom";

import { Badge, type BadgeTone } from "@/components/badge";
import { SourceLink } from "@/components/source-link";
import { Button } from "@/components/ui/button";
import { type GraphOperation, WORK_TYPE_LABELS } from "@/core/operations";
import type { DiffChange, DiffEntry } from "@/core/proposal-diff";

import { MappingReview, type MappingView } from "./mapping-review";

/** What the page passes for each proposal. */
export type ProposalView = {
  id: string;
  summary: string;
  rationale: string;
  sourceLabel: string;
  sourceTone: BadgeTone;
  /** ISO timestamp, for ordering and the `<time>` element. */
  createdAt: string;
  /** The creation date as the page shows it, formatted on the server. */
  createdOn: string;
  /** `sample` is true in a demo project, whose triggers have no real GitHub page. */
  trigger?: { title: string; url: string; sample: boolean };
  /** Null when the stored operations are invalid; the proposal can then only be rejected. */
  operations: GraphOperation[] | null;
  entries: DiffEntry[];
  /** Set for a paired roadmap import, whose review shows where every item came from. */
  mapping?: MappingView;
};

type Draft = Record<string, unknown>;

// The fields a reviewer can edit, per operation type. Keys and ids stay fixed: an edit may change
// wording and values, not what the proposal touches.
const EDITABLE: Record<GraphOperation["type"], string[]> = {
  create_outcome: ["title", "description", "target", "priority"],
  update_outcome: [
    "title",
    "description",
    "target",
    "priority",
    "product_note",
  ],
  create_requirement: [
    "title",
    "description",
    "user_visible",
    "product_note",
    "target",
    "work_type",
    "team",
    "status",
  ],
  split_requirement: ["split_reason", "product_note"],
  update_requirement: [
    "title",
    "description",
    "user_visible",
    "product_note",
    "target",
    "work_type",
    "team",
  ],
  set_status: ["status", "product_note"],
  link_work_item: ["relation"],
  unlink_work_item: [],
  link_feedback: [],
  unlink_feedback: [],
};
const CHILD_FIELDS = [
  "title",
  "description",
  "user_visible",
  "status",
  "work_type",
];

const LABELS: Record<string, string> = {
  title: "Title",
  description: "Description",
  target: "Target (2027-Q1 or a date)",
  priority: "Priority",
  user_visible: "Customers can see or use it",
  product_note: "Product note (plain language)",
  split_reason: "Why it was split",
  status: "Status",
  relation: "Relation",
  work_type: "Kind of work",
  team: "Team (optional)",
};
const OPTIONS: Record<string, [string, string][]> = {
  status: [
    ["planned", "Planned"],
    ["in_progress", "In progress"],
    ["done", "Done"],
    ["dropped", "Dropped"],
  ],
  relation: [
    ["implements", "Implements it"],
    ["part_of", "Part of it"],
  ],
  work_type: [["", "Not set"], ...Object.entries(WORK_TYPE_LABELS)],
};
const LONG_TEXT = new Set(["description", "product_note", "split_reason"]);
// Optional fields that should be cleared, not set to an empty string, when emptied.
const NULLABLE = new Set(["target", "product_note", "work_type", "team"]);
// Past this many changes, the rest fold away so long imports stay easy to scan.
const SHOWN_CHANGES = 4;

// The second click of a double click would land on the next proposal once this one has left.
const ignoreRepeatClick = (event: MouseEvent): void => {
  if (event.detail > 1) event.preventDefault();
};

/**
 * A pending proposal with its readable diff and decision buttons.
 *
 * Args:
 *   proposal: The proposal to show.
 *   formAction: The queue's decision action.
 *   onSubmit: Called as a decision on this proposal is submitted.
 *   pending: True while any decision in the queue is being saved.
 *   error: Why the last decision on this proposal failed, if it did.
 *   viewOnly: True to show the proposal without the decision buttons.
 *   canEdit: False to offer approve and reject only.
 *
 * Returns:
 *   The card.
 */
export function ProposalCard({
  proposal,
  formAction,
  onSubmit,
  pending,
  error,
  viewOnly,
  canEdit,
}: {
  proposal: ProposalView;
  formAction: (formData: FormData) => void;
  onSubmit: () => void;
  pending: boolean;
  error?: string;
  viewOnly: boolean;
  canEdit: boolean;
}): ReactElement {
  const [draft, setDraft] = useState<Draft[] | null>(null);
  const [moves, setMoves] = useState<Record<string, string>>({});
  const [placements, setPlacements] = useState<Record<string, string | null>>(
    {},
  );
  const editing = draft !== null;
  const { mapping } = proposal;
  const undecided =
    mapping?.unplaced.filter((item) => !(item.requirement.key in placements))
      .length ?? 0;
  const mappingReview = mapping && proposal.operations && (
    <MappingReview
      operations={proposal.operations}
      mapping={mapping}
      moves={moves}
      placements={placements}
      onMove={(key, outcomeKey) => setMoves({ ...moves, [key]: outcomeKey })}
      onPlace={(key, outcomeKey) => {
        const next = { ...placements };
        if (outcomeKey === undefined) delete next[key];
        else next[key] = outcomeKey;
        setPlacements(next);
      }}
      disabled={pending || viewOnly}
    />
  );
  const shown = proposal.entries.slice(0, SHOWN_CHANGES);
  const folded = proposal.entries.slice(SHOWN_CHANGES);

  return (
    <article
      id={`proposal-${proposal.id}`}
      aria-labelledby={`proposal-${proposal.id}-summary`}
      // Linked to as #proposal-<id>: clear of the sticky top bar, and outlined while targeted.
      className="flex scroll-mt-24 flex-col gap-4 rounded-lg border border-border bg-card p-4 text-card-foreground target:border-ring target:ring-3 target:ring-ring/50 sm:p-5"
    >
      <header className="flex flex-col gap-2">
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge tone={proposal.sourceTone}>{proposal.sourceLabel}</Badge>
          <time dateTime={proposal.createdAt}>{proposal.createdOn}</time>
        </p>
        <h2
          id={`proposal-${proposal.id}-summary`}
          className="text-lg font-semibold break-words"
        >
          {proposal.summary}
        </h2>
        {proposal.trigger && (
          <p className="text-sm text-muted-foreground">
            Prompted by{" "}
            <SourceLink
              href={proposal.trigger.url}
              sample={proposal.trigger.sample}
              className="underline"
            >
              {proposal.trigger.title}
            </SourceLink>
          </p>
        )}
      </header>

      {proposal.rationale && (
        <section className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">Why</h3>
          <p className="text-sm">{proposal.rationale}</p>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">
          {editing ? "Edit before approving" : "What would change"}
        </h3>
        {proposal.operations === null ? (
          <p className="text-sm text-destructive">
            This proposal&rsquo;s changes are not in a valid format, so it can
            only be rejected.
          </p>
        ) : editing ? (
          <>
            {draft.map((op, i) => (
              <OperationEditor
                key={i}
                heading={proposal.entries[i].heading}
                op={op}
                onChange={(next) =>
                  setDraft(draft.map((old, j) => (j === i ? next : old)))
                }
              />
            ))}
            {/* Where items go is chosen here, not in the editors, so it stays in view. */}
            {mappingReview}
          </>
        ) : mappingReview ? (
          mappingReview
        ) : (
          <>
            {shown.map((entry, i) => (
              <DiffBlock key={i} entry={entry} />
            ))}
            {folded.length > 0 && (
              <details className="flex flex-col gap-3">
                <summary className="cursor-pointer text-sm text-muted-foreground">
                  {folded.length} more{" "}
                  {folded.length === 1 ? "change" : "changes"}
                </summary>
                <div className="mt-3 flex flex-col gap-3">
                  {folded.map((entry, i) => (
                    <DiffBlock key={i} entry={entry} />
                  ))}
                </div>
              </details>
            )}
          </>
        )}
      </section>

      {!viewOnly && (
        <form
          action={formAction}
          onSubmit={onSubmit}
          className="flex flex-wrap items-center gap-2"
        >
          <input type="hidden" name="proposalId" value={proposal.id} />
          {editing && (
            <input
              type="hidden"
              name="operations"
              value={JSON.stringify(draft)}
            />
          )}
          {mapping && (
            <input
              type="hidden"
              name="mapping"
              value={JSON.stringify({ moves, placements })}
            />
          )}
          {proposal.operations !== null && (
            <Button
              type="submit"
              name="decision"
              value="approve"
              // The server refuses too; this only saves a round trip.
              disabled={pending || undecided > 0}
              onClick={ignoreRepeatClick}
            >
              {editing ? "Approve with edits" : "Approve"}
            </Button>
          )}
          {proposal.operations !== null &&
            canEdit &&
            (editing ? (
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => setDraft(null)}
              >
                Cancel edits
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => setDraft(structuredClone(proposal.operations))}
              >
                Edit
              </Button>
            ))}
          {!editing && (
            <Button
              type="submit"
              name="decision"
              value="reject"
              variant="destructive"
              disabled={pending}
              onClick={ignoreRepeatClick}
            >
              Reject
            </Button>
          )}
          <Saving />
          {undecided > 0 && (
            <p className="text-sm text-muted-foreground">
              Place or leave out{" "}
              {undecided === 1 ? "the item" : `all ${undecided} items`} under
              Needs a home to approve.
            </p>
          )}
        </form>
      )}
      <div aria-live="polite">
        {error && (
          <p className="text-sm whitespace-pre-line text-destructive">
            {error}
          </p>
        )}
      </div>
    </article>
  );
}

/** "Saving…" on the card whose decision is in flight, not on every card the queue disables. */
function Saving(): ReactElement | null {
  const { pending } = useFormStatus();
  return pending ? (
    <span className="text-sm text-muted-foreground">Saving…</span>
  ) : null;
}

function DiffBlock({ entry }: { entry: DiffEntry }): ReactElement {
  return (
    <div className="flex flex-col gap-1 rounded-md bg-muted/50 p-3 break-words">
      <p className="text-sm font-medium">{entry.heading}</p>
      {entry.changes.length > 0 && (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
          {entry.changes.map((change) => (
            <ChangeRow key={change.field} change={change} />
          ))}
        </dl>
      )}
    </div>
  );
}

function ChangeRow({ change }: { change: DiffChange }): ReactElement {
  const empty = <span className="text-muted-foreground italic">empty</span>;
  return (
    <>
      <dt className="text-muted-foreground">{change.field}</dt>
      <dd>
        {change.before !== undefined && (
          <>
            <del className="text-destructive">{change.before ?? empty}</del>
            {" → "}
          </>
        )}
        <ins className="text-emerald-700 no-underline dark:text-emerald-400">
          {change.after ?? empty}
        </ins>
      </dd>
    </>
  );
}

function OperationEditor({
  heading,
  op,
  onChange,
}: {
  heading: string;
  op: Draft;
  onChange: (next: Draft) => void;
}): ReactElement {
  const type = op.type as GraphOperation["type"];
  // An update only sets the fields it lists, so only those are offered.
  const fields = EDITABLE[type].filter(
    (field) => !type.startsWith("update_") || op[field] !== undefined,
  );
  const children = op.children as Draft[] | undefined;

  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-border p-3">
      <legend className="px-1 text-sm font-medium">{heading}</legend>
      {fields.length === 0 && !children && (
        <p className="text-sm text-muted-foreground">Nothing to edit.</p>
      )}
      {fields.map((field) => (
        <Field
          key={field}
          name={field}
          value={op[field]}
          onChange={(value) => onChange({ ...op, [field]: value })}
        />
      ))}
      {children?.map((child, i) => (
        <fieldset
          key={child.key as string}
          className="flex flex-col gap-3 border-l-2 border-border pl-3"
        >
          <legend className="text-sm font-medium">
            New piece {child.key as string}
          </legend>
          {CHILD_FIELDS.map((field) => (
            <Field
              key={field}
              name={field}
              value={child[field]}
              onChange={(value) =>
                onChange({
                  ...op,
                  children: children.map((old, j) =>
                    j === i ? { ...old, [field]: value } : old,
                  ),
                })
              }
            />
          ))}
        </fieldset>
      ))}
    </fieldset>
  );
}

function Field({
  name,
  value,
  onChange,
}: {
  name: string;
  value: unknown;
  onChange: (value: unknown) => void;
}): ReactElement {
  const label = LABELS[name];
  const inputClass =
    "w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

  if (name === "user_visible") {
    return (
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
        />
        {label}
      </label>
    );
  }

  const text = (raw: string): unknown =>
    NULLABLE.has(name) && raw.trim() === "" ? null : raw;
  let input: ReactElement;
  if (OPTIONS[name]) {
    input = (
      <select
        value={String(value ?? "")}
        onChange={(event) => onChange(text(event.target.value))}
        className={inputClass}
      >
        {OPTIONS[name].map(([option, optionLabel]) => (
          <option key={option} value={option}>
            {optionLabel}
          </option>
        ))}
      </select>
    );
  } else if (name === "priority") {
    input = (
      <input
        type="number"
        step={1}
        value={String(value ?? 0)}
        onChange={(event) => onChange(Number(event.target.value))}
        className={inputClass}
      />
    );
  } else if (LONG_TEXT.has(name)) {
    input = (
      <textarea
        rows={3}
        value={String(value ?? "")}
        onChange={(event) => onChange(text(event.target.value))}
        className={inputClass}
      />
    );
  } else {
    input = (
      <input
        type="text"
        value={String(value ?? "")}
        onChange={(event) => onChange(text(event.target.value))}
        className={inputClass}
      />
    );
  }
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {input}
    </label>
  );
}
