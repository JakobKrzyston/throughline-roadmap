"use client";
/** The plan page's outcome list: drag or use the buttons to reorder, and edit targets, kinds of work and teams in place. Exports PlanBoard, PlanOutcome. */
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import {
  type FormEvent,
  type ReactElement,
  startTransition,
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from "react";

import { Badge, type BadgeTone } from "@/components/badge";
import { Button } from "@/components/ui/button";
import { WORK_TYPE_LABELS, type WorkType } from "@/core/operations";
import { formatTarget } from "@/core/product-text";

import {
  moveOutcome,
  type PlanState,
  saveRequirement,
  saveTarget,
} from "./actions";

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
    workType: WorkType | null;
    /** The requirement's own team; null when it has none. */
    team: string | null;
    /** The team it gets from an ancestor when it has none of its own. */
    inheritedTeam: string | null;
    /** How deep in the split tree, 0 for a root requirement. */
    depth: number;
    status: { label: string; tone: BadgeTone };
  }[];
};

type Requirement = PlanOutcome["requirements"][number];
type Direction = "up" | "down";

const INPUT_CLASS =
  "h-8 rounded-md border border-input bg-background px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
// The field's own label on a narrow row; on a wide one the column headings say it instead.
const FIELD_LABEL_CLASS = "text-xs text-muted-foreground @2xl:sr-only";
// Requirement, target, kind of work, team, save: the headings and every row share these columns.
const ROW_COLUMNS =
  "@2xl:grid-cols-[minmax(0,1fr)_7.5rem_8rem_9.5rem_4.5rem] @2xl:items-center";

/**
 * Every outcome in priority order, with reorder controls and target forms.
 *
 * Args:
 *   slug: The project's slug.
 *   outcomes: Live outcomes, highest priority first.
 *   teams: The project's team names, suggested in the team boxes so one team keeps one spelling.
 *   quarters: Upcoming quarters, suggested in the target boxes.
 *   editable: False on a view-only project: the plan is shown without controls.
 *   allowFreeText: False to leave out free-text fields, the reason for a move and team names (on a
 *     public deployment).
 *
 * Returns:
 *   The board.
 */
export function PlanBoard({
  slug,
  outcomes,
  teams,
  quarters,
  editable,
  allowFreeText,
}: {
  slug: string;
  outcomes: PlanOutcome[];
  teams: string[];
  quarters: string[];
  editable: boolean;
  allowFreeText: boolean;
}): ReactElement {
  const [dragging, setDragging] = useState<string | null>(null);
  const [state, setState] = useState<PlanState>({ status: "idle" });
  const [moved, setMoved] = useState<string | null>(null);
  const [pending, startMove] = useTransition();
  // The Up or Down button to focus once a move has rendered.
  const focusAfterMove = useRef<{ key: string; direction: Direction } | null>(
    null,
  );
  const id = useId();
  const buttonId = (key: string, direction: Direction): string =>
    `${id}-${key}-${direction}`;

  const move = (key: string, toKey: string, direction?: Direction): void => {
    setMoved(key);
    focusAfterMove.current = direction ? { key, direction } : null;
    startMove(async () => setState(await moveOutcome(slug, key, toKey)));
  };

  useEffect(() => {
    const focus = focusAfterMove.current;
    if (pending || !focus) return;
    focusAfterMove.current = null;
    // The pressed button moved with its outcome; at the top or bottom it is disabled, so use the other one.
    const index = outcomes.findIndex((o) => o.key === focus.key);
    const atEnd =
      focus.direction === "up" ? index === 0 : index === outcomes.length - 1;
    const direction = atEnd
      ? focus.direction === "up"
        ? "down"
        : "up"
      : focus.direction;
    document.getElementById(buttonId(focus.key, direction))?.focus();
  });

  const movedIndex = outcomes.findIndex((o) => o.key === moved);
  const announcement =
    !pending && state.status === "idle" && movedIndex !== -1
      ? `“${outcomes[movedIndex].title}” is now number ${movedIndex + 1} of ${outcomes.length}.`
      : "";

  return (
    <div className="flex flex-col gap-3">
      {editable && (
        <p className="text-sm text-muted-foreground">
          A target is a quarter, like 2027-Q1, or a date, like 2027-01-11: pick
          an upcoming quarter from the list or type either.
          {!allowFreeText &&
            " Team names cannot be changed on the public site, so that visitors’ wording never shows to everyone."}
        </p>
      )}
      <div aria-live="polite" className="text-sm">
        {pending && <p className="text-muted-foreground">Saving…</p>}
        {state.status === "error" && (
          <p className="text-destructive">{state.message}</p>
        )}
        {announcement && (
          <p className="text-muted-foreground">{announcement}</p>
        )}
      </div>
      <datalist id={`${id}-teams`}>
        {teams.map((team) => (
          <option key={team} value={team} />
        ))}
      </datalist>
      <datalist id={`${id}-quarters`}>
        {quarters.map((quarter) => (
          <option key={quarter} value={quarter}>
            {formatTarget(quarter)}
          </option>
        ))}
      </datalist>
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
            className={`rounded-lg border bg-card p-4 text-card-foreground ${dragging === outcome.key ? "border-primary opacity-60" : "border-border"}`}
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
                className="flex items-start gap-2"
              >
                {editable && (
                  <GripVertical
                    aria-hidden
                    className="mt-0.5 size-4 shrink-0 cursor-grab text-muted-foreground"
                  />
                )}
                <h3 className="min-w-0 flex-1 font-semibold">
                  <span className="mr-2 text-sm font-normal text-muted-foreground">
                    {i + 1}. <span className="font-mono">{outcome.key}</span>
                  </span>
                  {outcome.title}
                </h3>
                {editable && (
                  <span className="flex shrink-0 gap-1">
                    {(["up", "down"] as const).map((direction) => {
                      const to = outcomes[direction === "up" ? i - 1 : i + 1];
                      const Icon = direction === "up" ? ArrowUp : ArrowDown;
                      return (
                        <Button
                          key={direction}
                          id={buttonId(outcome.key, direction)}
                          variant="outline"
                          size="icon-sm"
                          aria-label={`Move “${outcome.title}” ${direction}`}
                          title={`Move ${direction}`}
                          disabled={pending || !to}
                          onClick={() => move(outcome.key, to.key, direction)}
                        >
                          <Icon aria-hidden />
                        </Button>
                      );
                    })}
                  </span>
                )}
              </div>

              <TargetForm
                // Remount when the saved target changes, so the box shows it.
                key={outcome.target}
                slug={slug}
                outcome={outcome}
                editable={editable}
                allowReason={allowFreeText}
                quarterListId={`${id}-quarters`}
              />
              {outcome.warnings.length > 0 && (
                <ul className="flex flex-col gap-1 rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
                  {outcome.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}

              {outcome.requirements.length > 0 && (
                <details className="@container">
                  <summary className="cursor-pointer text-sm font-medium">
                    Requirements ({outcome.requirements.length})
                  </summary>
                  <div
                    aria-hidden
                    className={`mt-2 hidden gap-2 border-b border-border pb-1 text-xs text-muted-foreground @2xl:grid ${ROW_COLUMNS}`}
                  >
                    <span>Requirement</span>
                    <span>Target</span>
                    <span>Kind of work</span>
                    <span>Team</span>
                  </div>
                  <ul className="divide-y divide-border">
                    {outcome.requirements.map((requirement) => (
                      <li key={requirement.key}>
                        <RequirementRow
                          // Remount when the saved values change, so the boxes show them.
                          key={`${requirement.target}:${requirement.workType}:${requirement.team}`}
                          slug={slug}
                          requirement={requirement}
                          editable={editable}
                          allowTeam={allowFreeText}
                          quarterListId={`${id}-quarters`}
                          teamListId={`${id}-teams`}
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

/**
 * Submit a form's values to its action without React's automatic form reset.
 *
 * A form `action` resets the form once it finishes, and that puts a controlled select back to its
 * first value even when the save failed. Calling the action from a submit handler skips the reset,
 * so what the person entered stays until a successful save remounts the form.
 */
function submitWith(
  formAction: (data: FormData) => void,
): (event: FormEvent<HTMLFormElement>) => void {
  return (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  };
}

function SaveButton({
  label,
  pending,
  unchanged,
}: {
  label: string;
  pending: boolean;
  unchanged: boolean;
}): ReactElement {
  return (
    <Button
      type="submit"
      size="sm"
      // Filled when there is something to save, so it stands apart from the faded disabled state.
      variant={unchanged ? "outline" : "default"}
      disabled={pending || unchanged}
      aria-label={label}
      className="w-[4.5rem]"
    >
      {pending ? "Saving…" : "Save"}
    </Button>
  );
}

function TargetForm({
  slug,
  outcome,
  editable,
  allowReason,
  quarterListId,
}: {
  slug: string;
  outcome: PlanOutcome;
  editable: boolean;
  allowReason: boolean;
  quarterListId: string;
}): ReactElement {
  const [state, formAction, pending] = useActionState<PlanState, FormData>(
    saveTarget.bind(null, slug),
    { status: "idle" },
  );
  const [value, setValue] = useState(outcome.target ?? "");
  const [reason, setReason] = useState("");
  const id = useId();

  if (!editable) {
    return (
      <p className="text-sm text-muted-foreground">
        Target: {outcome.target ? formatTarget(outcome.target) : "none yet"}
      </p>
    );
  }
  return (
    <form onSubmit={submitWith(formAction)} className="flex flex-col gap-1">
      <input type="hidden" name="key" value={outcome.key} />
      <div className="flex flex-wrap items-center gap-2">
        <label
          htmlFor={`${id}-target`}
          className="text-sm text-muted-foreground"
        >
          Target
        </label>
        <input
          id={`${id}-target`}
          name="target"
          list={quarterListId}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="None"
          aria-label={`Target for ${outcome.title}`}
          aria-invalid={state.status === "error" || undefined}
          className={`${INPUT_CLASS} w-32`}
        />
        {allowReason && (
          <input
            name="reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why it moved (optional)"
            aria-label={`Why the target for ${outcome.title} changed, for the change feed (optional)`}
            className={`${INPUT_CLASS} min-w-48 flex-1`}
          />
        )}
        <SaveButton
          label={`Save target for ${outcome.title}`}
          pending={pending}
          unchanged={value.trim() === (outcome.target ?? "")}
        />
      </div>
      <div aria-live="polite">
        {state.status === "error" && (
          <p className="text-sm text-destructive">{state.message}</p>
        )}
      </div>
    </form>
  );
}

function RequirementRow({
  slug,
  requirement,
  editable,
  allowTeam,
  quarterListId,
  teamListId,
}: {
  slug: string;
  requirement: Requirement;
  editable: boolean;
  allowTeam: boolean;
  quarterListId: string;
  teamListId: string;
}): ReactElement {
  const [state, formAction, pending] = useActionState<PlanState, FormData>(
    saveRequirement.bind(null, slug),
    { status: "idle" },
  );
  const [target, setTarget] = useState(requirement.target ?? "");
  const [workType, setWorkType] = useState(requirement.workType ?? "");
  const [team, setTeam] = useState(requirement.team ?? "");
  const id = useId();
  const name = `${requirement.key} ${requirement.title}`;
  const shownTeam = requirement.team ?? requirement.inheritedTeam;

  const title = (
    <p
      style={{ paddingLeft: `${requirement.depth}rem` }}
      className="col-span-full text-sm @2xl:col-span-1"
    >
      <span className="font-mono text-muted-foreground">{requirement.key}</span>{" "}
      {requirement.title}{" "}
      <Badge tone={requirement.status.tone}>{requirement.status.label}</Badge>
    </p>
  );

  if (!editable) {
    return (
      <div className={`grid grid-cols-3 gap-2 py-2 text-sm ${ROW_COLUMNS}`}>
        {title}
        {[
          ["Target", requirement.target && formatTarget(requirement.target)],
          [
            "Kind of work",
            requirement.workType && WORK_TYPE_LABELS[requirement.workType],
          ],
          ["Team", shownTeam],
        ].map(([label, value]) => (
          <p key={label} className="flex flex-col">
            <span className={FIELD_LABEL_CLASS}>{label}</span>
            <span className={value ? "" : "text-muted-foreground"}>
              {value ?? "Not set"}
            </span>
          </p>
        ))}
      </div>
    );
  }

  const unchanged =
    target.trim() === (requirement.target ?? "") &&
    workType === (requirement.workType ?? "") &&
    team.trim() === (requirement.team ?? "");
  return (
    <form onSubmit={submitWith(formAction)} className="flex flex-col py-2">
      <input type="hidden" name="key" value={requirement.key} />
      <div className={`grid grid-cols-2 items-end gap-2 ${ROW_COLUMNS}`}>
        {title}
        <label htmlFor={`${id}-target`} className="flex min-w-0 flex-col">
          <span className={FIELD_LABEL_CLASS}>Target</span>
          <input
            id={`${id}-target`}
            name="target"
            list={quarterListId}
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            placeholder="None"
            aria-label={`Target for ${name}`}
            className={`${INPUT_CLASS} w-full min-w-0`}
          />
        </label>
        <label htmlFor={`${id}-type`} className="flex min-w-0 flex-col">
          <span className={FIELD_LABEL_CLASS}>Kind of work</span>
          <select
            id={`${id}-type`}
            name="work_type"
            value={workType}
            onChange={(event) => setWorkType(event.target.value)}
            aria-label={`Kind of work for ${name}`}
            className={`${INPUT_CLASS} w-full min-w-0`}
          >
            <option value="">Not set</option>
            {Object.entries(WORK_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {allowTeam ? (
          <label htmlFor={`${id}-team`} className="flex min-w-0 flex-col">
            <span className={FIELD_LABEL_CLASS}>Team</span>
            <input
              id={`${id}-team`}
              name="team"
              list={teamListId}
              value={team}
              onChange={(event) => setTeam(event.target.value)}
              // An empty box keeps the inherited team, so show which one that is.
              placeholder={
                requirement.inheritedTeam
                  ? `${requirement.inheritedTeam} (parent)`
                  : "None"
              }
              title={
                requirement.inheritedTeam
                  ? `Empty uses the parent's team, ${requirement.inheritedTeam}`
                  : undefined
              }
              aria-label={`Team for ${name}`}
              className={`${INPUT_CLASS} w-full min-w-0`}
            />
          </label>
        ) : (
          <p className="flex min-w-0 flex-col text-sm">
            {/* The board's note says why team names cannot be changed here. */}
            <input type="hidden" name="team" value={team} />
            <span className={FIELD_LABEL_CLASS}>Team</span>
            <span
              className={`flex h-8 items-center ${shownTeam ? "" : "text-muted-foreground"}`}
            >
              {shownTeam ?? "None"}
            </span>
          </p>
        )}
        <span className="flex justify-end">
          <SaveButton
            label={`Save ${name}`}
            pending={pending}
            unchanged={unchanged}
          />
        </span>
      </div>
      <div aria-live="polite">
        {state.status === "error" && (
          <p className="pt-1 text-sm text-destructive">{state.message}</p>
        )}
      </div>
    </form>
  );
}
