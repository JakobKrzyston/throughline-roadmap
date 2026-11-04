"use client";
/** One pending proposal in the review queue: summary, rationale, readable diff, and approve / edit / reject. Exports ProposalCard, ProposalView. */
import { type ReactElement, useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import type { GraphOperation } from "@/core/operations";
import type { DiffChange, DiffEntry } from "@/core/proposal-diff";

import { type DecideState, decideProposal } from "./actions";

/** What the page passes for each proposal. */
export type ProposalView = {
  id: string;
  summary: string;
  rationale: string;
  sourceLabel: string;
  createdAt: string;
  trigger?: { title: string; url: string };
  /** Null when the stored operations are invalid; the proposal can then only be rejected. */
  operations: GraphOperation[] | null;
  entries: DiffEntry[];
};

type Draft = Record<string, unknown>;

// The fields a reviewer can edit, per operation type. Keys and ids stay fixed: an edit may change
// wording and values, not what the proposal touches.
const EDITABLE: Record<GraphOperation["type"], string[]> = {
  create_outcome: ["title", "description", "target", "priority"],
  update_outcome: ["title", "description", "target", "priority"],
  create_requirement: ["title", "description", "user_visible", "product_note"],
  split_requirement: ["split_reason", "product_note"],
  update_requirement: ["title", "description", "user_visible", "product_note"],
  set_status: ["status", "product_note"],
  link_work_item: ["relation"],
  unlink_work_item: [],
};
const CHILD_FIELDS = ["title", "description", "user_visible", "status"];

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
};
const LONG_TEXT = new Set(["description", "product_note", "split_reason"]);
// Optional fields that should be cleared, not set to an empty string, when emptied.
const NULLABLE = new Set(["target", "product_note"]);

/**
 * A pending proposal with its readable diff and decision buttons.
 *
 * Args:
 *   slug: The project's slug.
 *   proposal: The proposal to show.
 *   viewOnly: True to show the proposal without the decision buttons.
 */
export function ProposalCard({
  slug,
  proposal,
  viewOnly,
}: {
  slug: string;
  proposal: ProposalView;
  viewOnly: boolean;
}): ReactElement {
  const [state, formAction, pending] = useActionState<DecideState, FormData>(
    decideProposal.bind(null, slug),
    { status: "idle" },
  );
  const [draft, setDraft] = useState<Draft[] | null>(null);
  const editing = draft !== null;

  return (
    <article
      id={`proposal-${proposal.id}`}
      className="flex flex-col gap-4 rounded-lg border border-border p-5"
    >
      <header className="flex flex-col gap-1">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {proposal.sourceLabel} ·{" "}
          <time dateTime={proposal.createdAt}>
            {new Date(proposal.createdAt).toLocaleDateString()}
          </time>
        </p>
        <h2 className="text-lg font-semibold">{proposal.summary}</h2>
        {proposal.trigger && (
          <p className="text-sm text-muted-foreground">
            Prompted by{" "}
            <a href={proposal.trigger.url} className="underline">
              {proposal.trigger.title}
            </a>
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
          draft.map((op, i) => (
            <OperationEditor
              key={i}
              heading={proposal.entries[i].heading}
              op={op}
              onChange={(next) =>
                setDraft(draft.map((old, j) => (j === i ? next : old)))
              }
            />
          ))
        ) : (
          proposal.entries.map((entry, i) => (
            <DiffBlock key={i} entry={entry} />
          ))
        )}
      </section>

      {!viewOnly && (
        <form action={formAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="proposalId" value={proposal.id} />
          {editing && (
            <input
              type="hidden"
              name="operations"
              value={JSON.stringify(draft)}
            />
          )}
          {proposal.operations !== null && (
            <Button
              type="submit"
              name="decision"
              value="approve"
              disabled={pending}
            >
              {editing ? "Approve with edits" : "Approve"}
            </Button>
          )}
          {proposal.operations !== null &&
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
            >
              Reject
            </Button>
          )}
          {pending && (
            <span className="text-sm text-muted-foreground">Saving…</span>
          )}
        </form>
      )}
      <div aria-live="polite">
        {state.status === "error" && (
          <p className="text-sm whitespace-pre-line text-destructive">
            {state.message}
          </p>
        )}
      </div>
    </article>
  );
}

function DiffBlock({ entry }: { entry: DiffEntry }): ReactElement {
  return (
    <div className="flex flex-col gap-1 rounded-md bg-muted/50 p-3">
      <p className="text-sm font-medium">{entry.heading}</p>
      {entry.changes.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
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
        value={String(value)}
        onChange={(event) => onChange(event.target.value)}
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
