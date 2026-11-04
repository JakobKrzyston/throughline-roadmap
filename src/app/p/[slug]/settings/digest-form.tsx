"use client";
/** The "Weekly digest" form on the settings page. Exports DigestForm. */
import { type ReactElement, useActionState } from "react";

import { Button } from "@/components/ui/button";

import {
  type DigestState,
  saveDigest,
  sendDigest,
  type SendState,
  stopDigest,
} from "./actions";

/**
 * Form that starts the weekly Slack digest, or once it is set up, sends it now or stops it.
 *
 * Args:
 *   slug: The project's slug.
 *   active: True when a Slack webhook is saved.
 */
export function DigestForm({
  slug,
  active,
}: {
  slug: string;
  active: boolean;
}): ReactElement {
  const [state, formAction, pending] = useActionState<DigestState, FormData>(
    saveDigest.bind(null, slug),
    { status: "idle" },
  );
  const [sendState, sendAction, sending] = useActionState<SendState>(
    sendDigest.bind(null, slug),
    { status: "idle" },
  );

  if (active) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <form action={sendAction}>
            <Button type="submit" disabled={sending}>
              {sending ? "Sending…" : "Send now"}
            </Button>
          </form>
          <form action={stopDigest.bind(null, slug)}>
            <Button type="submit" variant="outline">
              Stop sending
            </Button>
          </form>
        </div>
        <div aria-live="polite">
          {sendState.status === "error" && (
            <p className="text-sm text-destructive">{sendState.message}</p>
          )}
          {sendState.status === "success" && (
            <p className="text-sm">{sendState.message}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label htmlFor="webhookUrl" className="text-sm font-medium">
        Slack incoming webhook URL
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id="webhookUrl"
          name="webhookUrl"
          type="url"
          required
          defaultValue={state.status === "error" ? state.webhookUrl : ""}
          placeholder="https://hooks.slack.com/services/…"
          autoComplete="off"
          spellCheck={false}
          className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:max-w-md"
        />
        <Button type="submit" disabled={pending}>
          {pending ? "Sending…" : "Send and save"}
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
