"use client";
/** Error state for every project page: a plain-language message and a way to try again. */
import { type ReactElement, useEffect } from "react";

import { Button } from "@/components/ui/button";

/**
 * Shown when a project page fails to load.
 *
 * Args:
 *   error: What was thrown; logged for debugging, never shown.
 *   retry: Re-renders the page.
 *
 * Returns:
 *   The error message.
 */
export default function ProjectError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}): ReactElement {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col items-start gap-4 px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">
        This page did not load
      </h1>
      <p className="text-muted-foreground">
        Something went wrong on our side, and it is usually temporary. Try
        again, and if it keeps happening, come back in a few minutes.
      </p>
      <Button onClick={() => retry()}>Try again</Button>
    </main>
  );
}
