"use client";
/** The "Connect a repository" form on the settings page. Exports ConnectForm. */
import { type ReactElement, useActionState } from "react";

import { Button } from "@/components/ui/button";

import { type ConnectState, connectRepository } from "./actions";

/**
 * Form that connects a GitHub repository to the project.
 *
 * Args:
 *   slug: The project's slug.
 *   disabled: True when GitHub is not set up, so connecting cannot work.
 */
export function ConnectForm({
  slug,
  disabled,
}: {
  slug: string;
  disabled: boolean;
}): ReactElement {
  const [state, formAction, pending] = useActionState<ConnectState, FormData>(
    connectRepository.bind(null, slug),
    { status: "idle" },
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label htmlFor="repository" className="text-sm font-medium">
        Repository
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id="repository"
          name="repository"
          required
          disabled={disabled}
          defaultValue={state.status === "error" ? state.repository : ""}
          placeholder="owner/name"
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
