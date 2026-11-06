"use client";
/** The "Import from Linear" form: loads the teams on request, then offers a team picker and an import button. Exports LinearImportForm. */
import Link from "next/link";
import {
  type ReactElement,
  useActionState,
  useState,
  useTransition,
} from "react";

import type { LinearTeam } from "@/adapters/linear/source";
import { Button } from "@/components/ui/button";

import {
  importFromLinear,
  type LinearImportState,
  loadLinearTeams,
} from "./linear-actions";

/**
 * Form that imports one Linear team's roadmap and links to the resulting proposal.
 *
 * Args:
 *   slug: The project's slug.
 */
export function LinearImportForm({ slug }: { slug: string }): ReactElement {
  const [teams, setTeams] = useState<LinearTeam[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [state, formAction, pending] = useActionState<
    LinearImportState,
    FormData
  >(importFromLinear.bind(null, slug), { status: "idle" });

  if (!teams) {
    return (
      <div className="flex flex-col gap-2">
        <div>
          <Button
            type="button"
            variant="outline"
            disabled={loading}
            onClick={() =>
              startLoading(async () => {
                const result = await loadLinearTeams(slug);
                if (result.ok) setTeams(result.teams);
                setLoadError(result.ok ? null : result.message);
              })
            }
          >
            {loading ? "Reading Linear…" : "Choose a Linear team"}
          </Button>
        </div>
        <p aria-live="polite" className="text-sm text-destructive">
          {loadError}
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="linear-team" className="text-sm font-medium">
          Linear team
        </label>
        <select
          id="linear-team"
          name="team"
          defaultValue={teams[0].id}
          className="h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-2 text-sm"
        >
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Importing…" : "Import from Linear"}
        </Button>
      </div>
      <div aria-live="polite">
        {state.status === "error" && (
          <p className="text-sm text-destructive">{state.message}</p>
        )}
        {state.status === "success" && (
          <p className="text-sm">
            {state.summary}.{" "}
            <Link href={state.reviewHref} className="font-medium underline">
              Review the proposal
            </Link>
          </p>
        )}
      </div>
    </form>
  );
}
