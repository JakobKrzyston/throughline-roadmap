/** /p/[slug]/settings: connect GitHub repositories to the project and set up the weekly digest. */
import { asc, eq, sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { type ReactElement, Suspense } from "react";

import { githubInstallUrl, missingGitHubSettings } from "@/adapters/github";
import { SectionsSkeleton } from "@/components/skeleton";
import { loadDigest } from "@/core/digest";
import { getDb } from "@/db/client";
import { projects, repositories } from "@/db/schema";
import { type BackfillStatus, backfillStatuses } from "@/jobs/backfill";
import { isPublicDeployment } from "@/lib/public-deployment";
import { appOrigin } from "@/lib/app-origin";

import { ConnectForm } from "./connect-form";
import { DigestForm } from "./digest-form";

// The connect action imports the repository's history after responding; allow it time to finish.
export const maxDuration = 300;

export const metadata = { title: "Settings" };

/**
 * Settings page: a static heading plus the project's connected repositories and connect form.
 *
 * Args:
 *   params: Route params holding the project slug.
 *
 * Returns:
 *   The page.
 */
export default function SettingsPage({
  params,
}: PageProps<"/p/[slug]/settings">): ReactElement {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Connect a GitHub repository so Throughline can follow its issues and
          pull requests. A pull request that says &ldquo;Implements TL-12&rdquo;
          or &ldquo;Part of TL-12&rdquo; is linked to that requirement
          automatically.
        </p>
      </div>
      {/* The project lookup runs per request; the heading above is the static shell. */}
      <Suspense fallback={<SectionsSkeleton />}>
        <ProjectSettings params={params} />
      </Suspense>
    </main>
  );
}

async function ProjectSettings({
  params,
}: Pick<PageProps<"/p/[slug]/settings">, "params">): Promise<ReactElement> {
  const { slug } = await params;
  // The database read is uncached, so render this part per request rather than prerendering it.
  await connection();
  const db = getDb();
  const [project] = await db
    .select({
      id: projects.id,
      name: projects.name,
      slug: projects.slug,
      // Only whether a webhook is saved: the URL itself lets anyone post to the channel.
      digestActive: sql<boolean>`${projects.digestSlackWebhookUrl} is not null`,
      digestSentAt: projects.digestSentAt,
    })
    .from(projects)
    .where(eq(projects.slug, slug));
  if (!project) notFound();

  const connected = await db
    .select({ id: repositories.id, fullName: repositories.fullName })
    .from(repositories)
    .where(eq(repositories.projectId, project.id))
    .orderBy(asc(repositories.fullName));
  const imports = await backfillStatuses(
    db,
    connected.map((repository) => repository.id),
  );
  const missing = missingGitHubSettings();
  const configured = missing.length === 0;
  const installUrl = githubInstallUrl();
  const digest = await loadDigest(db, project, await appOrigin());

  return (
    <>
      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">GitHub repositories</h2>
        {connected.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No repositories connected yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {connected.map((repository) => (
              <li key={repository.id} className="flex flex-col gap-0.5">
                <span className="font-mono">{repository.fullName}</span>
                <ImportStatus status={imports.get(repository.id)} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Connect a repository</h2>
        {isPublicDeployment() ? (
          <p className="rounded-md border border-border bg-muted p-3 text-sm">
            On the public site, repositories are connected by the site owner.
          </p>
        ) : configured ? (
          <ol className="list-decimal pl-5 text-sm text-muted-foreground">
            <li>
              {installUrl ? (
                <a href={installUrl} className="font-medium underline">
                  Install the Throughline GitHub App
                </a>
              ) : (
                "Install the Throughline GitHub App"
              )}{" "}
              on the repository.
            </li>
            <li>
              Enter it below. Throughline imports its open issues and the pull
              requests merged in the last 90 days.
            </li>
          </ol>
        ) : (
          <p className="rounded-md border border-border bg-muted p-3 text-sm">
            GitHub is not set up on this server, so repositories cannot be
            connected. Set {missing.join(", ")}; the setup steps are in
            docs/GITHUB_APP.md.
          </p>
        )}
        {!isPublicDeployment() && (
          <ConnectForm slug={slug} disabled={!configured} />
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Weekly digest</h2>
        <p className="text-sm text-muted-foreground">
          Every Monday morning, Throughline can post a plain-language summary to
          a Slack channel for people who do not follow the roadmap day to day:
          what changed in the past week and where each outcome stands. It is
          written from the roadmap itself, so it says nothing the product view
          does not.
        </p>
        {project.digestActive ? (
          <p className="text-sm">
            Posting to Slack every Monday.
            {project.digestSentAt &&
              ` Last sent ${project.digestSentAt.toLocaleDateString("en-GB", {
                weekday: "long",
                day: "numeric",
                month: "long",
                timeZone: "UTC",
              })}.`}
          </p>
        ) : isPublicDeployment() ? (
          <p className="rounded-md border border-border bg-muted p-3 text-sm">
            On the public site, digests are set up by the site owner.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            In Slack, add an incoming webhook for the channel and paste its URL
            below. Throughline sends this week&rsquo;s digest straight away, so
            you can check it arrives.
          </p>
        )}
        {!isPublicDeployment() && (
          <DigestForm slug={slug} active={project.digestActive} />
        )}
        <h3 className="text-sm font-medium">The next digest so far</h3>
        <pre className="rounded-md border border-border bg-muted p-4 font-sans text-sm whitespace-pre-wrap">
          {digest}
        </pre>
      </section>
    </>
  );
}

function ImportStatus({
  status,
}: {
  status: BackfillStatus | undefined;
}): ReactElement | null {
  switch (status?.state) {
    case undefined:
    case "done":
      return null;
    case "importing":
      return (
        <span className="text-muted-foreground">
          Importing issues and pull requests…
        </span>
      );
    case "retrying":
      return (
        <span className="text-muted-foreground">
          The import hit a problem and will try again: {status.error}
        </span>
      );
    case "failed":
      return (
        <span className="text-destructive">
          The import stopped after repeated failures, so some issues and pull
          requests are missing: {status.error}
        </span>
      );
  }
}
