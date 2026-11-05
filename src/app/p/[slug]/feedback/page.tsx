/** /p/[slug]/feedback: customer feedback grouped by the outcome it asks for, and the asks the roadmap does not cover. */
import { cn } from "cn";
import { eq } from "drizzle-orm";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { type ReactElement, type ReactNode, Suspense } from "react";

import { Badge } from "@/components/badge";
import { CardsSkeleton } from "@/components/skeleton";
import { SourceLink } from "@/components/source-link";
import { buttonVariants } from "@/components/ui/button";
import { type FeedbackView, loadFeedbackBoard } from "@/core/feedback";
import { getDb } from "@/db/client";
import { projects } from "@/db/schema";
import { isViewOnly } from "@/lib/public-deployment";

import { ViewOnlyNotice } from "../view-only-notice";
import { LinkFeedbackForm, UnlinkFeedbackButton } from "./feedback-forms";

export const metadata = { title: "Customer feedback" };

/**
 * Feedback page: a static heading plus the project's feedback.
 *
 * Args:
 *   params: Route params holding the project slug.
 *
 * Returns:
 *   The page.
 */
export default function FeedbackPage({
  params,
}: PageProps<"/p/[slug]/feedback">): ReactElement {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          Customer feedback
        </h1>
        <p className="text-muted-foreground">
          What customers ask for, grouped by the outcome that would deliver it.
          Feedback no outcome covers is a gap in the roadmap.
        </p>
      </div>
      {/* The feedback is read per request; the heading above is the static shell. */}
      <Suspense fallback={<CardsSkeleton />}>
        <FeedbackBoardView params={params} />
      </Suspense>
    </main>
  );
}

async function FeedbackBoardView({
  params,
}: Pick<PageProps<"/p/[slug]/feedback">, "params">): Promise<ReactElement> {
  const { slug } = await params;
  // The database read is uncached, so render this part per request rather than prerendering it.
  await connection();
  const db = getDb();
  const [project] = await db
    .select({ id: projects.id, name: projects.name, isDemo: projects.isDemo })
    .from(projects)
    .where(eq(projects.slug, slug));
  if (!project) notFound();

  const board = await loadFeedbackBoard(db, project.id);
  const editable = !isViewOnly(project);
  const outcomeOptions = board.outcomes.map(({ key, title }) => ({
    key,
    title,
  }));
  const titleOf = new Map(board.outcomes.map((o) => [o.key, o.title]));
  const mostAsked = Math.max(
    1,
    ...board.outcomes.map((o) => o.feedback.length),
  );
  const total =
    board.outcomes.reduce((sum, o) => sum + o.feedback.length, 0) +
    board.inReview.length +
    board.gaps.reduce((sum, g) => sum + g.feedback.length, 0);

  return (
    <>
      {!editable && <ViewOnlyNotice />}
      {total === 0 ? (
        <p className="rounded-md border border-border p-6 text-center text-muted-foreground">
          No feedback yet. Label an issue <code>feedback</code> in a{" "}
          <Link
            href={`/p/${slug}/settings`}
            className="font-medium text-foreground underline"
          >
            connected repository
          </Link>{" "}
          and it appears here.
        </p>
      ) : (
        <>
          {board.gaps.length === 0 ? (
            <section aria-labelledby="gaps" className="flex flex-col gap-1">
              <h2 id="gaps" className="text-xl font-semibold">
                Not on the roadmap
              </h2>
              <p className="text-sm text-muted-foreground">
                Every piece of feedback is covered by an outcome.
              </p>
            </section>
          ) : (
            // Gaps come first and stand out: they are what the roadmap is missing.
            <section
              aria-labelledby="gaps"
              className="flex flex-col gap-4 rounded-lg border border-amber-300 bg-amber-50 p-4 sm:p-5 dark:border-amber-800 dark:bg-amber-950/40"
            >
              <div className="flex flex-col gap-1">
                <h2 id="gaps" className="text-xl font-semibold">
                  Not on the roadmap
                </h2>
                <p className="text-sm text-amber-900 dark:text-amber-200">
                  Customers ask for these, but no outcome covers them yet.
                </p>
              </div>
              <ol className="flex flex-col gap-3">
                {board.gaps.map((gap) => (
                  <li
                    key={gap.theme ?? ""}
                    className="flex flex-col gap-3 rounded-md border border-border bg-card p-4"
                  >
                    <h3 className="flex flex-wrap items-center gap-2 font-medium">
                      {gap.theme ?? "Not sorted yet"}
                      <Badge tone="amber">
                        {requests(gap.feedback.length)}
                      </Badge>
                    </h3>
                    <ul className="flex flex-col gap-3">
                      {gap.feedback.map((item) => (
                        <FeedbackRow
                          key={item.id}
                          item={item}
                          sample={project.isDemo}
                          hideTheme
                        >
                          {editable && outcomeOptions.length > 0 && (
                            <LinkFeedbackForm
                              slug={slug}
                              feedbackId={item.id}
                              feedbackTitle={item.title}
                              outcomes={outcomeOptions}
                            />
                          )}
                        </FeedbackRow>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <section aria-labelledby="pull" className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <h2 id="pull" className="text-xl font-semibold">
                Asked for, by outcome
              </h2>
              <p className="text-sm text-muted-foreground">
                Most asked for first.
              </p>
            </div>
            <ol className="flex flex-col divide-y divide-border rounded-md border border-border">
              {board.outcomes.map((outcome) => (
                <li key={outcome.key} className="px-4 py-3">
                  {outcome.feedback.length === 0 ? (
                    <div className="flex gap-2">
                      {/* Lines the title up with the expandable rows' chevrons. */}
                      <span aria-hidden className="size-4 shrink-0" />
                      <Demand
                        title={outcome.title}
                        count={0}
                        mostAsked={mostAsked}
                      />
                    </div>
                  ) : (
                    <details className="group">
                      <summary className="flex cursor-pointer list-none gap-2 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
                        <ChevronRight
                          aria-hidden
                          className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
                        />
                        <Demand
                          title={outcome.title}
                          count={outcome.feedback.length}
                          mostAsked={mostAsked}
                        />
                      </summary>
                      <ul className="mt-3 flex flex-col gap-3 pl-6">
                        {outcome.feedback.map((item) => (
                          <FeedbackRow
                            key={item.id}
                            item={item}
                            sample={project.isDemo}
                          >
                            {editable && (
                              <UnlinkFeedbackButton
                                slug={slug}
                                feedbackId={item.id}
                                outcomeKey={outcome.key}
                                feedbackTitle={item.title}
                              />
                            )}
                          </FeedbackRow>
                        ))}
                      </ul>
                    </details>
                  )}
                </li>
              ))}
            </ol>
          </section>

          {board.inReview.length > 0 && (
            <section aria-labelledby="review" className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <h2 id="review" className="text-xl font-semibold">
                  Waiting for review
                </h2>
                <p className="text-sm text-muted-foreground">
                  Throughline matched these to an outcome. They count once a
                  person approves the match.
                </p>
              </div>
              <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
                {board.inReview.map((item) => (
                  <FeedbackRow
                    key={item.id}
                    item={item}
                    sample={project.isDemo}
                    note={`Suggested outcome: ${titleOf.get(item.outcomeKey) ?? item.outcomeKey}`}
                    className="px-4 py-3"
                  >
                    <Link
                      href={`/p/${slug}/review#proposal-${item.proposalId}`}
                      // cn drops the base border-transparent, as Button does, so the outline shows.
                      className={cn(
                        buttonVariants({ variant: "outline", size: "sm" }),
                        "self-start sm:self-auto",
                      )}
                      aria-label={`Review the match for “${item.title}”`}
                    >
                      Review match
                    </Link>
                  </FeedbackRow>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </>
  );
}

/**
 * An outcome's title with how much feedback asks for it, as a count and a bar.
 *
 * Args:
 *   title: The outcome's title.
 *   count: How many pieces of feedback are linked to it.
 *   mostAsked: The largest count on the page, which fills the bar.
 *
 * Returns:
 *   The title, count and bar.
 */
function Demand({
  title,
  count,
  mostAsked,
}: {
  title: string;
  count: number;
  mostAsked: number;
}): ReactElement {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-2">
      <span className="flex items-baseline justify-between gap-3">
        <span className="font-medium">{title}</span>
        <span
          className={`shrink-0 text-sm tabular-nums ${count === 0 ? "text-muted-foreground" : "font-semibold"}`}
        >
          {count === 0 ? "No feedback yet" : requests(count)}
        </span>
      </span>
      <span aria-hidden className="block h-1.5 rounded-full bg-muted">
        <span
          className="block h-full rounded-full bg-sky-600 dark:bg-sky-400"
          style={{ width: `${(count / mostAsked) * 100}%` }}
        />
      </span>
    </span>
  );
}

/**
 * One piece of feedback: its title linked to the source, with actions beside it on wide
 * screens and below it on narrow ones.
 *
 * Args:
 *   item: The feedback.
 *   sample: True for a demo project, whose feedback has no real GitHub page.
 *   hideTheme: True to leave out the theme, when the group already names it.
 *   note: A line of detail under the title.
 *   className: Extra classes for the row.
 *   children: Actions for the feedback.
 *
 * Returns:
 *   The list item.
 */
function FeedbackRow({
  item,
  sample,
  hideTheme = false,
  note,
  className = "",
  children,
}: {
  item: FeedbackView;
  sample: boolean;
  hideTheme?: boolean;
  note?: string;
  className?: string;
  children?: ReactNode;
}): ReactElement {
  return (
    <li
      className={`flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between ${className}`}
    >
      <span className="flex min-w-0 flex-col gap-1">
        <span>
          <SourceLink
            href={item.url}
            sample={sample}
            className="underline underline-offset-4"
          >
            {item.title}
          </SourceLink>
          {!hideTheme && item.theme && (
            <span className="text-muted-foreground"> · {item.theme}</span>
          )}
        </span>
        {note && <span className="text-muted-foreground">{note}</span>}
      </span>
      {children}
    </li>
  );
}

function requests(count: number): string {
  return count === 1 ? "1 request" : `${count} requests`;
}
