/** /p/[slug]/feedback: customer feedback grouped by the outcome it asks for, and the asks the roadmap does not cover. */
import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { type ReactElement, type ReactNode, Suspense } from "react";

import { type FeedbackView, loadFeedbackBoard } from "@/core/feedback";
import { getDb } from "@/db/client";
import { projects } from "@/db/schema";
import { isViewOnly } from "@/lib/public-deployment";

import { ProjectNav } from "../project-nav";
import { ViewOnlyNotice } from "../view-only-notice";
import { LinkFeedbackForm, UnlinkFeedbackButton } from "./feedback-forms";

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
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-12">
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
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
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
  const total =
    board.outcomes.reduce((sum, o) => sum + o.feedback.length, 0) +
    board.inReview.length +
    board.gaps.reduce((sum, g) => sum + g.feedback.length, 0);

  return (
    <>
      <ProjectNav slug={slug} name={project.name} current="/feedback" />
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
          <section aria-labelledby="pull" className="flex flex-col gap-3">
            <h2 id="pull" className="text-xl font-semibold">
              Asked for, by outcome
            </h2>
            <ol className="flex flex-col gap-3">
              {board.outcomes.map((outcome) => (
                <li
                  key={outcome.key}
                  className="rounded-md border border-border p-4"
                >
                  <details>
                    <summary className="cursor-pointer">
                      <span className="font-medium">{outcome.title}</span>{" "}
                      <span className="text-sm text-muted-foreground">
                        {pieces(outcome.feedback.length)}
                      </span>
                    </summary>
                    {outcome.feedback.length > 0 && (
                      <ul className="mt-3 flex flex-col gap-2">
                        {outcome.feedback.map((item) => (
                          <FeedbackRow key={item.id} item={item}>
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
                    )}
                  </details>
                </li>
              ))}
            </ol>
          </section>

          {board.inReview.length > 0 && (
            <section aria-labelledby="review" className="flex flex-col gap-3">
              <h2 id="review" className="text-xl font-semibold">
                Waiting for review
              </h2>
              <p className="text-sm text-muted-foreground">
                Throughline matched these to an outcome. They count once the
                match is approved in the{" "}
                <Link href={`/p/${slug}/review`} className="underline">
                  review queue
                </Link>
                .
              </p>
              <ul className="flex flex-col gap-2">
                {board.inReview.map((item) => (
                  <FeedbackRow key={item.id} item={item}>
                    <span className="text-sm text-muted-foreground">
                      Suggested:{" "}
                      {titleOf.get(item.outcomeKey) ?? item.outcomeKey}
                    </span>
                  </FeedbackRow>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="gaps" className="flex flex-col gap-3">
            <h2 id="gaps" className="text-xl font-semibold">
              Not on the roadmap
            </h2>
            {board.gaps.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Every piece of feedback is covered by an outcome.
              </p>
            ) : (
              <ol className="flex flex-col gap-3">
                {board.gaps.map((gap) => (
                  <li
                    key={gap.theme ?? ""}
                    className="flex flex-col gap-2 rounded-md border border-border p-4"
                  >
                    <h3 className="font-medium">
                      {gap.theme ?? "Not sorted yet"}{" "}
                      <span className="text-sm font-normal text-muted-foreground">
                        {pieces(gap.feedback.length)}
                      </span>
                    </h3>
                    <ul className="flex flex-col gap-2">
                      {gap.feedback.map((item) => (
                        <FeedbackRow key={item.id} item={item} hideTheme>
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
            )}
          </section>
        </>
      )}
    </>
  );
}

function FeedbackRow({
  item,
  hideTheme = false,
  children,
}: {
  item: FeedbackView;
  hideTheme?: boolean;
  children?: ReactNode;
}): ReactElement {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span>
        <a href={item.url} className="underline underline-offset-4">
          {item.title}
        </a>
        {!hideTheme && item.theme && (
          <span className="text-muted-foreground"> · {item.theme}</span>
        )}
      </span>
      {children}
    </li>
  );
}

function pieces(count: number): string {
  return count === 1 ? "1 piece of feedback" : `${count} pieces of feedback`;
}
