"use client";
/** The paste box and "Generate proposal" button on the import page. Exports ImportForm. */
import Link from "next/link";
import { type ReactElement, useActionState } from "react";

import { Button } from "@/components/ui/button";

import { generateImportProposal, type ImportState } from "./actions";

/**
 * Form that sends a pasted roadmap to the import agent and links to the resulting proposal.
 *
 * Args:
 *   slug: The project's slug.
 */
export function ImportForm({ slug }: { slug: string }): ReactElement {
  const [state, formAction, pending] = useActionState<ImportState, FormData>(
    generateImportProposal.bind(null, slug),
    { status: "idle" },
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label htmlFor="roadmap" className="text-sm font-medium">
        Roadmap
      </label>
      <textarea
        id="roadmap"
        name="roadmap"
        required
        rows={16}
        defaultValue={state.status === "error" ? state.roadmap : ""}
        placeholder="Paste a roadmap, planning notes or a product brief. Markdown is fine."
        className="w-full rounded-md border border-input bg-transparent p-3 font-mono text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Generating…" : "Generate proposal"}
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
