"use client";
/** The "Connect a repository" and "Connect a Linear team" forms on the settings page. Exports ConnectForm. */
import { type ReactElement, useActionState } from "react";

import { Button } from "@/components/ui/button";

import {
  type ConnectState,
  connectLinearTeam,
  connectRepository,
} from "./actions";

const FIELDS = {
  github: {
    action: connectRepository,
    id: "repository",
    label: "Repository",
    placeholder: "owner/name",
  },
  linear: {
    action: connectLinearTeam,
    id: "linear-team",
    label: "Linear team key",
    placeholder: "ENG",
  },
};

/**
 * Form that connects a GitHub repository or a Linear team to the project.
 *
 * Args:
 *   slug: The project's slug.
 *   source: What it connects.
 *   disabled: True when the source is not set up, so connecting cannot work.
 */
export function ConnectForm({
  slug,
  source,
  disabled,
}: {
  slug: string;
  source: "github" | "linear";
  disabled: boolean;
}): ReactElement {
  const fields = FIELDS[source];
  const [state, formAction, pending] = useActionState<ConnectState, FormData>(
    fields.action.bind(null, slug),
    { status: "idle" },
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label htmlFor={fields.id} className="text-sm font-medium">
        {fields.label}
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id={fields.id}
          name="repository"
          required
          disabled={disabled}
          defaultValue={state.status === "error" ? state.repository : ""}
          placeholder={fields.placeholder}
          autoComplete="off"
          spellCheck={false}
          className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 sm:max-w-sm"
        />
        <Button type="submit" disabled={disabled || pending}>
          {pending ? "Connecting…" : "Connect"}
        </Button>
      </div>
      <div aria-live="polite">
        {state.status === "error" && (
          <p className="text-sm text-destructive">{state.message}</p>
        )}
        {state.status === "success" && (
          <p className="text-sm">{state.message}</p>
        )}
      </div>
    </form>
  );
}
