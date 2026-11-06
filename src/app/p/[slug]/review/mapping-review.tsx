"use client";
/** The mapping review for a paired roadmap import: requirements under their outcomes with their source rows, the items that need a home, and what was left out. Exports MappingReview, MappingView. */
import type { ReactElement } from "react";

import { Badge } from "@/components/badge";
import { type ImportMapping, LEFT_OUT_REASONS } from "@/core/import-mapping";
import type { GraphOperation } from "@/core/operations";

/** A proposal's import mapping, plus the project's live outcomes a requirement can move to. */
export type MappingView = ImportMapping & {
  projectOutcomes: { key: string; title: string }[];
};

type Option = { key: string; title: string };

// The select value that leaves an unplaced item out; outcome keys never look like this.
const LEAVE_OUT = "leave-out";

const selectClass =
  "w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:w-auto";

/**
 * Show where every imported item came from and let the reviewer change where it goes.
 *
 * Args:
 *   operations: The proposal's operations as stored, before any moves.
 *   mapping: The proposal's import mapping.
 *   moves: Requirement key to the outcome key the reviewer moved it to.
 *   placements: Unplaced requirement key to its outcome key, or null when left out. A key with
 *     no entry is still undecided.
 *   onMove: Called with a requirement key and the outcome key chosen for it.
 *   onPlace: Called with an unplaced key and its outcome key, null to leave it out, or undefined
 *     to undo the choice.
 *   disabled: True while a decision is being saved, or when the viewer cannot decide.
 *
 * Returns:
 *   The review.
 */
export function MappingReview({
  operations,
  mapping,
  moves,
  placements,
  onMove,
  onPlace,
  disabled,
}: {
  operations: GraphOperation[];
  mapping: MappingView;
  moves: Record<string, string>;
  placements: Record<string, string | null>;
  onMove: (requirementKey: string, outcomeKey: string) => void;
  onPlace: (
    requirementKey: string,
    outcomeKey: string | null | undefined,
  ) => void;
  disabled: boolean;
}): ReactElement {
  const created = operations.flatMap((op) =>
    op.type === "create_outcome" ? [op] : [],
  );
  const requirements = operations.flatMap((op) =>
    op.type === "create_requirement" ? [op] : [],
  );
  const outcomeOf = (requirement: (typeof requirements)[number]): string =>
    moves[requirement.key] ?? requirement.outcome_key;
  const sourcesOf = (key: string): string[] =>
    [...mapping.outcomes, ...mapping.requirements].find(
      (item) => item.key === key,
    )?.records ?? [];
  const linkOf = new Map(mapping.requirements.map((item) => [item.key, item]));
  const options = {
    created: created.map(({ key, title }) => ({ key, title })),
    project: mapping.projectOutcomes,
  };
  const titleOf = (key: string): string =>
    [...options.created, ...options.project].find(
      (option) => option.key === key,
    )?.title ?? key;
  // The proposal's outcomes, then any project outcome a requirement was moved to.
  const groups = [
    ...options.created.map((option) => option.key),
    ...mapping.projectOutcomes
      .map((option) => option.key)
      .filter((key) =>
        requirements.some((requirement) => outcomeOf(requirement) === key),
      ),
  ];

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">
          Outcomes and the work that delivers them
        </h3>
        {groups.map((outcomeKey) => {
          const outcome = created.find((op) => op.key === outcomeKey);
          const under = requirements.filter(
            (requirement) => outcomeOf(requirement) === outcomeKey,
          );
          return (
            <div
              key={outcomeKey}
              className="flex flex-col gap-3 rounded-md bg-muted/50 p-3 break-words"
            >
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium">
                  {outcome ? "New outcome" : "Existing outcome"} {outcomeKey}:{" "}
                  {titleOf(outcomeKey)}
                  {outcome?.target && (
                    <span className="font-normal text-muted-foreground">
                      {" "}
                      · {outcome.target}
                    </span>
                  )}
                </p>
                {outcome && (
                  <SourceRows
                    records={sourcesOf(outcomeKey)}
                    mapping={mapping}
                  />
                )}
              </div>
              {under.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No technical work planned yet, so it shows as not started.
                </p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {under.map((requirement) => {
                    const link = linkOf.get(requirement.key);
                    return (
                      <li
                        key={requirement.key}
                        className="flex flex-col gap-2 border-l-2 border-border pl-3"
                      >
                        <p className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="font-medium">
                            {requirement.key}: {requirement.title}
                          </span>
                          {requirement.status === "in_progress" && (
                            <Badge tone="blue">In progress</Badge>
                          )}
                          {requirement.status === "done" && (
                            <Badge tone="green">Done</Badge>
                          )}
                          {link?.confidence === "low" && (
                            <Badge tone="amber">Low-confidence link</Badge>
                          )}
                        </p>
                        {link && (
                          <p className="text-sm text-muted-foreground">
                            {link.reason}
                          </p>
                        )}
                        <SourceRows
                          records={sourcesOf(requirement.key)}
                          mapping={mapping}
                        />
                        <OutcomeSelect
                          label={`Outcome for ${requirement.title}`}
                          value={outcomeOf(requirement)}
                          options={options}
                          disabled={disabled}
                          onChange={(value) => onMove(requirement.key, value)}
                        />
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </section>

      {mapping.unplaced.length > 0 && (
        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-medium">Needs a home</h3>
          <p className="text-sm text-muted-foreground">
            These technical items do not clearly deliver any outcome. Place each
            one under an outcome, or leave it out, before approving.
          </p>
          <ul className="flex flex-col gap-3">
            {mapping.unplaced.map((item) => {
              const { key, title } = item.requirement;
              const placement = placements[key];
              return (
                <li
                  key={key}
                  className="flex flex-col gap-2 rounded-md border border-dashed border-border p-3 break-words"
                >
                  <p className="text-sm font-medium">
                    {key}: {title}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {item.reason}
                    {item.suggested_outcome_key &&
                      ` Suggested: ${titleOf(item.suggested_outcome_key)}.`}
                  </p>
                  <SourceRows records={item.records} mapping={mapping} />
                  <OutcomeSelect
                    label={`Where ${title} goes`}
                    value={
                      placement === undefined ? "" : (placement ?? LEAVE_OUT)
                    }
                    options={options}
                    disabled={disabled}
                    undecided
                    onChange={(value) =>
                      onPlace(
                        key,
                        value === ""
                          ? undefined
                          : value === LEAVE_OUT
                            ? null
                            : value,
                      )
                    }
                  />
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {mapping.left_out.length > 0 && (
        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-medium">Left out</h3>
          <ul className="flex flex-col gap-3">
            {mapping.left_out.map((entry) => (
              <li
                key={entry.records.join()}
                className="flex flex-col gap-1 text-sm break-words"
              >
                <p>
                  {entry.title}{" "}
                  <span className="text-muted-foreground">
                    ({LEFT_OUT_REASONS[entry.reason]})
                  </span>
                </p>
                <SourceRows records={entry.records} mapping={mapping} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function OutcomeSelect({
  label,
  value,
  options,
  disabled,
  undecided = false,
  onChange,
}: {
  label: string;
  value: string;
  options: { created: Option[]; project: Option[] };
  disabled: boolean;
  /** True for an unplaced item, which offers "Choose" and "Leave it out" as well. */
  undecided?: boolean;
  onChange: (value: string) => void;
}): ReactElement {
  return (
    <label className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:gap-2">
      <span className="sr-only">{label}</span>
      <span aria-hidden className="text-muted-foreground">
        {undecided ? "Goes under" : "Delivers"}
      </span>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={selectClass}
      >
        {undecided && <option value="">Choose where it goes</option>}
        <optgroup label="In this import">
          {options.created.map((option) => (
            <option key={option.key} value={option.key}>
              {option.title}
            </option>
          ))}
        </optgroup>
        {options.project.length > 0 && (
          <optgroup label="Already in the project">
            {options.project.map((option) => (
              <option key={option.key} value={option.key}>
                {option.title}
              </option>
            ))}
          </optgroup>
        )}
        {undecided && <option value={LEAVE_OUT}>Leave it out</option>}
      </select>
    </label>
  );
}

/** The roadmap rows an item came from, under their CSV header when there is one. */
function SourceRows({
  records,
  mapping,
}: {
  records: string[];
  mapping: ImportMapping;
}): ReactElement | null {
  if (records.length === 0) return null;
  // References are a letter for the roadmap and a number; a CSV's header is that letter with 0.
  const roadmaps = [...new Set(records.map((ref) => ref[0]))];
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted-foreground">
        Source {records.length === 1 ? "row" : "rows"}
      </summary>
      {roadmaps.map((letter) => (
        <pre
          key={letter}
          className="mt-2 overflow-x-auto rounded bg-background p-2 font-mono text-xs whitespace-pre-wrap"
        >
          {mapping.records[`${letter}0`] !== undefined && (
            <span className="block text-muted-foreground">
              {mapping.records[`${letter}0`]}
            </span>
          )}
          {records
            .filter((ref) => ref[0] === letter)
            .map((ref) => (
              <span key={ref} className="block">
                {mapping.records[ref] ?? ref}
              </span>
            ))}
        </pre>
      ))}
    </details>
  );
}
