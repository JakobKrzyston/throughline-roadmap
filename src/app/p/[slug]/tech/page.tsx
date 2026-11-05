/** /p/[slug]/tech: the technical view, outcome → requirement → work item tree and split history for engineering. */
import { eq } from "drizzle-orm";
import { Target } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { type ReactElement, Suspense } from "react";
import { z } from "zod";

import {
  type BreakdownFilter,
  filterOptions,
  visibleKeys,
} from "@/core/breakdown";
import { WORK_TYPE_LABELS, workTypeSchema } from "@/core/operations";
import { loadRoadmap, loadSplitHistory } from "@/core/roadmap";
import { teamProgress } from "@/core/rollup";
import { formatTarget } from "@/core/product-text";
import { lateRequirements } from "@/core/schedule";
import { getDb } from "@/db/client";
import { projects } from "@/db/schema";

import { ProjectNav } from "../project-nav";
import { ExpandAll } from "./expand-all";
import { FilterForm } from "./filter-form";
import {
  RequirementList,
  RollupBadge,
  RowSummary,
  Tag,
} from "./requirement-tree";

// Anything else in the address, such as a repeated or unknown value, is ignored rather than refused.
const filterSchema = z.object({
  type: workTypeSchema.optional().catch(undefined),
  team: z.string().min(1).optional().catch(undefined),
  person: z.string().min(1).optional().catch(undefined),
});

const SELECT_CLASS =
  "rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * Technical view: a static heading plus the project's requirement tree and split history.
 *
 * Args:
 *   params: Route params holding the project slug.
 *   searchParams: `type`, `team` and `person` filter the tree.
 *
 * Returns:
 *   The page.
 */
export default function TechPage({
  params,
  searchParams,
}: PageProps<"/p/[slug]/tech">): ReactElement {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          Technical roadmap
        </h1>
        <p className="text-muted-foreground">
          Every outcome with the requirements that deliver it and the issues and
          pull requests linked to each one. Open or close a row to see more.
        </p>
      </div>
      {/* The tree is read per request; the heading above is the static shell. */}
      <Suspense
        fallback={<p className="text-muted-foreground">Loading the roadmap…</p>}
      >
        <TechView params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function TechView({
  params,
  searchParams,
}: Pick<
  PageProps<"/p/[slug]/tech">,
  "params" | "searchParams"
>): Promise<ReactElement> {
  const { slug } = await params;
  const query = filterSchema.parse(await searchParams);
  const filter: BreakdownFilter = {
    workType: query.type,
    team: query.team,
    person: query.person,
  };
  const filtering = Object.values(filter).some((value) => value !== undefined);
  // The database read is uncached, so render this part per request rather than prerendering it.
  await connection();
  const db = getDb();
  const [project] = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(eq(projects.slug, slug));
  if (!project) notFound();

  const roadmap = await loadRoadmap(db, project.id);
  const splits = await loadSplitHistory(db, project.id, roadmap);
  const options = filterOptions(roadmap);
  const allSelects: Parameters<typeof FilterSelect>[0][] = [
    {
      name: "type",
      label: "Kind of work",
      value: filter.workType,
      options: options.workTypes.map((type) => [type, WORK_TYPE_LABELS[type]]),
    },
    {
      name: "team",
      label: "Team",
      value: filter.team,
      options: options.teams.map((team) => [team, team]),
    },
    {
      name: "person",
      label: "Person",
      value: filter.person,
      options: options.people.map((person) => [person, person]),
    },
  ];
  // A filter with nothing to choose from is left out.
  const selects = allSelects.filter((select) => select.options.length > 0);
  const shown = roadmap.flatMap((outcome) => {
    const keys = filtering ? visibleKeys(outcome.requirements, filter) : null;
    return keys?.size === 0 ? [] : [{ outcome, keys }];
  });

  return (
    <>
      <ProjectNav slug={slug} name={project.name} current="/tech" />

      <section aria-labelledby="tree" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="tree" className="text-xl font-semibold">
            Outcomes and requirements
          </h2>
          {shown.length > 0 && <ExpandAll />}
        </div>
        {roadmap.length > 0 && (selects.length > 0 || filtering) && (
          <FilterForm
            // Remount when the filter changes, so a link such as "Show everything" resets the choices.
            key={JSON.stringify(filter)}
            label="Filter requirements"
          >
            {selects.map((select) => (
              <FilterSelect key={select.name} {...select} />
            ))}
            {/* With JavaScript on, the form applies each change as it is made. */}
            <noscript>
              <button
                type="submit"
                className="rounded-md border border-border px-3 py-1 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                Filter
              </button>
            </noscript>
            {filtering && (
              <Link
                href={`/p/${slug}/tech`}
                className="pb-1 text-sm underline underline-offset-4"
              >
                Show everything
              </Link>
            )}
          </FilterForm>
        )}
        {roadmap.length === 0 ? (
          <p className="rounded-md border border-border p-6 text-center text-muted-foreground">
            No outcomes yet.{" "}
            <Link
              href={`/p/${slug}/import`}
              className="font-medium text-foreground underline"
            >
              Import a roadmap
            </Link>{" "}
            to create outcomes and requirements.
          </p>
        ) : shown.length === 0 ? (
          <p className="rounded-md border border-border p-6 text-center text-muted-foreground">
            No requirements match these filters.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {shown.map(({ outcome, keys }) => (
              <li
                key={outcome.id}
                className="rounded-lg border border-border bg-card p-3 sm:p-4"
              >
                <details open>
                  <RowSummary
                    rowKey={outcome.key}
                    title={
                      <span className="font-semibold">{outcome.title}</span>
                    }
                    status={<RollupBadge requirements={outcome.requirements} />}
                    hint={
                      outcome.requirements.length === 1
                        ? "1 requirement"
                        : `${outcome.requirements.length} requirements`
                    }
                  >
                    {outcome.target && (
                      <Tag icon={Target}>
                        Target {formatTarget(outcome.target)}
                      </Tag>
                    )}
                  </RowSummary>
                  <TeamRollup requirements={outcome.requirements} />
                  <div className="pt-2">
                    {outcome.requirements.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No requirements yet.
                      </p>
                    ) : (
                      <RequirementList
                        requirements={outcome.requirements}
                        shown={keys}
                        lateKeys={
                          new Set(
                            lateRequirements(
                              outcome.target,
                              outcome.requirements,
                            ).map((r) => r.key),
                          )
                        }
                      />
                    )}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="splits" className="flex flex-col gap-4">
        <h2 id="splits" className="text-xl font-semibold">
          Split history
        </h2>
        {splits.length === 0 ? (
          <p className="text-muted-foreground">
            No requirement has been split yet. When work turns out bigger than
            planned, the split and its reason are recorded here.
          </p>
        ) : (
          <ol className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
            {splits.map((split) => (
              <li key={split.id} className="flex flex-col gap-1.5 p-3 text-sm">
                <div className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="mr-1.5 font-mono text-xs text-muted-foreground">
                      {split.requirementKey}
                    </span>
                    <span className="font-medium">
                      {split.requirementTitle}
                    </span>
                  </span>
                  <time
                    dateTime={split.at.toISOString()}
                    className="shrink-0 text-xs text-muted-foreground"
                  >
                    {split.at.toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "long",
                      timeZone: "UTC",
                    })}
                  </time>
                </div>
                <p className="text-muted-foreground">{split.reason}</p>
                <ul aria-label="Split into" className="flex flex-wrap gap-1.5">
                  {split.children.map((child) => (
                    <li key={child.key}>
                      <Tag>
                        <span className="font-mono">{child.key}</span>
                        <span className="text-foreground">{child.title}</span>
                      </Tag>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}

function FilterSelect({
  name,
  label,
  value,
  options,
}: {
  name: string;
  label: string;
  value: string | undefined;
  options: [string, string][];
}): ReactElement {
  return (
    // A label that wraps the select would also take the option names into its accessible name.
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={`filter-${name}`} className="text-muted-foreground">
        {label}
      </label>
      <select
        id={`filter-${name}`}
        name={name}
        defaultValue={value ?? ""}
        className={SELECT_CLASS}
      >
        <option value="">Any</option>
        {options.map(([option, optionLabel]) => (
          <option key={option} value={option}>
            {optionLabel}
          </option>
        ))}
      </select>
    </div>
  );
}

/** "Platform 3 of 8 done" with a small bar for each team with work under an outcome, once any team is set. */
function TeamRollup({
  requirements,
}: {
  requirements: Parameters<typeof teamProgress>[0];
}): ReactElement | null {
  const teams = teamProgress(requirements);
  if (teams.every((entry) => entry.team === null)) return null;
  return (
    <ul
      aria-label="Progress by team"
      className="flex flex-wrap gap-1.5 pt-1 pl-6"
    >
      {teams.map((entry) => (
        <li
          key={entry.team ?? ""}
          className="flex items-center gap-1.5 rounded-md border border-border px-2 py-0.5 text-xs"
        >
          <span className="font-medium">{entry.team ?? "No team"}</span>
          <span className="text-muted-foreground">
            {entry.done} of {entry.total} done
          </span>
          <span
            aria-hidden
            className="hidden h-1.5 w-10 overflow-hidden rounded-full bg-muted sm:block"
          >
            <span
              className="block h-full rounded-full bg-emerald-500 dark:bg-emerald-400"
              style={{ width: `${(entry.done / entry.total) * 100}%` }}
            />
          </span>
        </li>
      ))}
    </ul>
  );
}
