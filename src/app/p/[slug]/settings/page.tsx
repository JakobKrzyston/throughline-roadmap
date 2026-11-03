/** /p/[slug]/settings: connect GitHub repositories to the project. */
import { asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { type ReactElement, Suspense } from "react";

import { githubInstallUrl, missingGitHubSettings } from "@/adapters/github";
import { getDb } from "@/db/client";
import { projects, repositories } from "@/db/schema";
import { type BackfillStatus, backfillStatuses } from "@/jobs/backfill";

import { ConnectForm } from "./connect-form";

// The connect action imports the repository's history after responding; allow it time to finish.
export const maxDuration = 300;

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
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-12">
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
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
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
    .select({ id: projects.id, name: projects.name })
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

  return (
    <>
      <p className="text-sm text-muted-foreground">
        Project: <span className="font-medium">{project.name}</span>
      </p>

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
        {configured ? (
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
        <ConnectForm slug={slug} disabled={!configured} />
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
