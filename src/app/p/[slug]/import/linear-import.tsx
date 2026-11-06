/** The import page's "Import from Linear" section: reads the workspace's teams and shows the form, or why Linear cannot be read. Exports LinearImport. */
import type { ReactElement } from "react";

import { linearSourceFor } from "@/adapters/linear";
import { LinearError, type LinearTeam } from "@/adapters/linear/source";

import { LinearImportForm } from "./linear-import-form";

/**
 * Section that imports a Linear team's initiatives and projects as a proposal.
 *
 * Args:
 *   slug: The project's slug.
 *   isDemo: Whether the project is a demo project, which always reads the sample workspace.
 *
 * Returns:
 *   The section.
 */
export async function LinearImport({
  slug,
  isDemo,
}: {
  slug: string;
  isDemo: boolean;
}): Promise<ReactElement> {
  const { source, sample } = linearSourceFor({ isDemo });
  let teams: LinearTeam[] = [];
  let error: string | null = null;
  try {
    teams = await source.listTeams();
  } catch (caught) {
    if (!(caught instanceof LinearError)) throw caught;
    error = caught.message;
  }

  return (
    <section
      aria-labelledby="linear-import"
      className="flex flex-col gap-3 border-t border-border pt-6"
    >
      <h2 id="linear-import" className="text-xl font-semibold">
        Import from Linear
      </h2>
      <p className="text-sm text-muted-foreground">
        Pick a team. Its initiatives become outcomes and its projects become
        requirements, with their target dates. Completed and canceled projects
        are left out.
      </p>
      {sample && (
        <p className="rounded-md border border-border bg-muted p-3 text-sm">
          {isDemo
            ? "Demo projects read a sample Linear workspace, so you can try this without an account."
            : "No LINEAR_API_KEY is set, so this reads a sample Linear workspace. See docs/LINEAR.md to import your own."}
        </p>
      )}
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : teams.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          The Linear workspace has no teams this API key can read.
        </p>
      ) : (
        <LinearImportForm slug={slug} teams={teams} />
      )}
    </section>
  );
}
