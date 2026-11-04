"use client";
/** The plan page's outcome list: drag or use the buttons to reorder, and edit targets in place. Exports PlanBoard, PlanOutcome. */
import { GripVertical } from "lucide-react";
import {
  type ReactElement,
  useActionState,
  useId,
  useState,
  useTransition,
} from "react";

import { Button } from "@/components/ui/button";
import { formatTarget } from "@/core/product-text";

import { moveOutcome, type PlanState, saveTarget } from "./actions";

/** One outcome as the page passes it, highest priority first. */
export type PlanOutcome = {
  key: string;
  title: string;
  target: string | null;
  /** Plain warnings about the target, e.g. work due after it. */
  warnings: string[];
  requirements: {
    key: string;
    title: string;
    target: string | null;
    /** How deep in the split tree, 0 for a root requirement. */
    depth: number;
    status: string;
  }[];
};

const INPUT_CLASS =
  "w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * Every outcome in priority order, with reorder controls and target forms.
 *
 * Args:
 *   slug: The project's slug.
 *   outcomes: Live outcomes, highest priority first.
 *   editable: False on a view-only project: the plan is shown without controls.
 *   allowReason: False to leave out the free-text reason (on a public deployment).
 */
export function PlanBoard({
  slug,
  outcomes,
  editable,
  allowReason,
}: {
  slug: string;
  outcomes: PlanOutcome[];
  editable: boolean;
  allowReason: boolean;
}): ReactElement {
  const [dragging, setDragging] = useState<string | null>(null);
  const [state, setState] = useState<PlanState>({ status: "idle" });
  const [pending, startTransition] = useTransition();

  const move = (key: string, toKey: string): void =>
    startTransition(async () => setState(await moveOutcome(slug, key, toKey)));

  return (
    <div className="flex flex-col gap-3">
      <div aria-live="polite" className="text-sm">
        {pending && <p className="text-muted-foreground">Saving…</p>}
        {state.status === "error" && (
          <p className="text-destructive">{state.message}</p>
        )}
      </div>
      <ol className="flex flex-col gap-3">
        {outcomes.map((outcome, i) => (
          <li
            key={outcome.key}
            onDragOver={(event) => {
              if (dragging) event.preventDefault();
            }}
            onDrop={(event) => {
              // Anything else, such as text dropped into a target box, keeps its default.
              if (!dragging) return;
              event.preventDefault();
              if (dragging !== outcome.key) move(dragging, outcome.key);
              setDragging(null);
            }}
            className={`flex flex-col gap-3 rounded-lg border p-4 ${dragging === outcome.key ? "border-primary opacity-60" : "border-border"}`}
          >
            <article aria-label={outcome.title} className="flex flex-col gap-3">
              {/* Only the header drags, so text in the target boxes can still be selected. */}
              <div
                draggable={editable && !pending}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  // Firefox starts a drag only when it carries some data.
                  event.dataTransfer.setData("text/plain", outcome.key);
                  setDragging(outcome.key);
                }}
                onDragEnd={() => setDragging(null)}
                className="flex flex-wrap items-center gap-2"
              >
                {editable && (
                  <GripVertical
                    aria-hidden
                    className="size-4 cursor-grab text-muted-foreground"
                  />
                )}
                <span className="text-sm text-muted-foreground">{i + 1}.</span>
                <span className="font-mono text-sm text-muted-foreground">
                  {outcome.key}
                </span>
                <h3 className="font-semibold">{outcome.title}</h3>
                {editable && (
                  <span className="ml-auto flex gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`Move “${outcome.title}” up`}
                      disabled={pending || i === 0}
                      onClick={() => move(outcome.key, outcomes[i - 1].key)}
                    >
                      Up
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`Move “${outcome.title}” down`}
                      disabled={pending || i === outcomes.length - 1}
                      onClick={() => move(outcome.key, outcomes[i + 1].key)}
                    >
                      Down
                    </Button>
                  </span>
                )}
              </div>

              <TargetForm
                // Remount when the saved target changes, so the box shows it.
                key={outcome.target}
                slug={slug}
                kind="outcome"
                itemKey={outcome.key}
                itemTitle={outcome.title}
                target={outcome.target}
                editable={editable}
                allowReason={allowReason}
              />
              {outcome.warnings.length > 0 && (
                <ul className="flex flex-col gap-1 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
                  {outcome.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}

              {outcome.requirements.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-sm font-medium">
                    Requirement targets ({outcome.requirements.length})
                  </summary>
                  <ul className="flex flex-col gap-2 pt-2">
                    {outcome.requirements.map((requirement) => (
                      <li
                        key={requirement.key}
                        style={{ paddingLeft: `${requirement.depth}rem` }}
                        className="flex flex-col gap-1"
                      >
                        <p className="text-sm">
                          <span className="font-mono text-muted-foreground">
                            {requirement.key}
                          </span>{" "}
                          {requirement.title}{" "}
                          <span className="text-muted-foreground">
                            ({requirement.status})
                          </span>
                        </p>
                        <TargetForm
                          key={requirement.target}
                          slug={slug}
                          kind="requirement"
                          itemKey={requirement.key}
                          itemTitle={`${requirement.key} ${requirement.title}`}
                          target={requirement.target}
                          editable={editable}
                          allowReason={false}
                        />
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </article>
          </li>
        ))}
      </ol>
    </div>
  );
}

function TargetForm({
  slug,
  kind,
  itemKey,
  itemTitle,
  target,
  editable,
  allowReason,
}: {
  slug: string;
  kind: "outcome" | "requirement";
  itemKey: string;
  itemTitle: string;
  target: string | null;
  editable: boolean;
  allowReason: boolean;
}): ReactElement {
  const [state, formAction, pending] = useActionState<PlanState, FormData>(
    saveTarget.bind(null, slug),
    { status: "idle" },
  );
  // Controlled, so a refused value stays in the box to correct.
  const [value, setValue] = useState(target ?? "");
  const [reason, setReason] = useState("");
  const id = useId();

  if (!editable) {
    return (
      <p className="text-sm text-muted-foreground">
        Target: {target ? formatTarget(target) : "none yet"}
      </p>
    );
  }
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="key" value={itemKey} />
      <div className="flex flex-wrap items-end gap-2">
        <label htmlFor={`${id}-target`} className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Target</span>
          <input
            id={`${id}-target`}
            name="target"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="2027-Q1 or 2027-01-11"
            aria-label={`Target for ${itemTitle}`}
            className={`${INPUT_CLASS} w-44`}
          />
        </label>
        {allowReason && (
          <label
            htmlFor={`${id}-reason`}
            className="flex min-w-48 flex-1 flex-col gap-1 text-sm"
          >
            <span className="text-muted-foreground">
              Why, for the change feed (optional)
            </span>
            <input
              id={`${id}-reason`}
              name="reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="We are shipping single sign-on first."
              className={INPUT_CLASS}
            />
          </label>
        )}
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={pending || value.trim() === (target ?? "")}
          aria-label={`Save target for ${itemTitle}`}
        >
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
      <div aria-live="polite">
        {state.status === "error" && (
          <p className="text-sm text-destructive">{state.message}</p>
        )}
      </div>
    </form>
  );
}
