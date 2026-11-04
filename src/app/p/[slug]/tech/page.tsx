/** /p/[slug]/tech: the technical view, outcome → requirement → work item tree and split history for engineering. */
import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { type ReactElement, Suspense } from "react";
import { z } from "zod";

import { Badge } from "@/components/badge";
import {
  type BreakdownFilter,
  filterOptions,
  visibleKeys,
} from "@/core/breakdown";
import { workTypeSchema } from "@/core/operations";
import { WORK_TYPE_LABELS } from "@/core/proposal-diff";
import { loadRoadmap, loadSplitHistory } from "@/core/roadmap";
import { outcomeProgress, teamProgress } from "@/core/rollup";
import { formatTarget } from "@/core/product-text";
import { lateRequirements } from "@/core/schedule";
import { getDb } from "@/db/client";
import { projects } from "@/db/schema";

import { ProjectNav } from "../project-nav";
import { RequirementList, SUMMARY_CLASS } from "./requirement-tree";

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
  const shown = roadmap.flatMap((outcome) => {
    const keys = filtering ? visibleKeys(outcome.requirements, filter) : null;
    return keys?.size === 0 ? [] : [{ outcome, keys }];
  });

  return (
    <>
      <ProjectNav slug={slug} name={project.name} current="/tech" />

      <section aria-labelledby="tree" className="flex flex-col gap-4">
        <h2 id="tree" className="text-xl font-semibold">
          Outcomes and requirements
        </h2>
        {roadmap.length > 0 && (
          <form
            method="get"
            aria-label="Filter requirements"
            className="flex flex-wrap items-end gap-3"
          >
            <FilterSelect
              name="type"
              label="Kind of work"
              value={filter.workType}
              options={Object.entries(WORK_TYPE_LABELS)}
            />
            <FilterSelect
              name="team"
              label="Team"
              value={filter.team}
              options={options.teams.map((team) => [team, team])}
            />
            <FilterSelect
              name="person"
              label="Person"
              value={filter.person}
              options={options.people.map((person) => [person, person])}
            />
            <button
              type="submit"
              className="rounded-md border border-border px-3 py-1 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              Filter
            </button>
            {filtering && (
              <Link
                href={`/p/${slug}/tech`}
                className="text-sm underline underline-offset-4"
              >
                Show everything
              </Link>
            )}
          </form>
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
                className="rounded-lg border border-border p-4"
              >
                <details open>
                  <summary className={SUMMARY_CLASS}>
                    <span className="font-mono text-sm text-muted-foreground">
                      {outcome.key}
                    </span>
                    <span className="font-semibold">{outcome.title}</span>
                    <Badge tone="blue">
                      {Math.round(outcomeProgress(outcome.requirements) * 100)}%
                      done
                    </Badge>
                    {outcome.target && (
                      <span className="text-xs text-muted-foreground">
                        Target {formatTarget(outcome.target)}
                      </span>
                    )}
                  </summary>
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
          <ol className="flex flex-col gap-4">
            {splits.map((split) => (
              <li key={split.id} className="flex flex-col gap-1">
                <p>
                  <span className="font-mono text-sm">
                    {split.requirementKey}
                  </span>{" "}
                  {split.requirementTitle} was split into{" "}
                  {split.children
                    .map((child) => `${child.key} ${child.title}`)
                    .join(", ")}
                  .
                </p>
                <p className="text-sm text-muted-foreground">
                  <time dateTime={split.at.toISOString()}>
                    {split.at.toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                      timeZone: "UTC",
                    })}
                  </time>
                  : {split.reason}
                </p>
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
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <select name={name} defaultValue={value ?? ""} className={SELECT_CLASS}>
        <option value="">Any</option>
        {options.map(([option, optionLabel]) => (
          <option key={option} value={option}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

/** "Platform: 3 of 8 done" for each team with work under an outcome, once any team is set. */
function TeamRollup({
  requirements,
}: {
  requirements: Parameters<typeof teamProgress>[0];
}): ReactElement | null {
  const teams = teamProgress(requirements);
  if (teams.every((entry) => entry.team === null)) return null;
  return (
    <p className="pt-1 text-sm text-muted-foreground">
      {teams
        .map(
          (entry) =>
            `${entry.team ?? "No team"}: ${entry.done} of ${entry.total} done`,
        )
        .join(" · ")}
    </p>
  );
}
