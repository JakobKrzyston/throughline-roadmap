"use client";
/** The import page's form: paste box, file upload, sample exports and "Generate proposal" button. Exports ImportForm. */
import Link from "next/link";
import { type ReactElement, useActionState, useRef } from "react";

import { Button } from "@/components/ui/button";
import {
  FILE_TOO_LARGE,
  MAX_ROADMAP_CHARS,
  ROADMAP_FILE_TYPES,
} from "@/lib/roadmap-input";

import { generateImportProposal, type ImportState } from "./actions";

/**
 * Form that sends a pasted or uploaded roadmap to the import agent and links to the resulting proposal.
 *
 * Args:
 *   slug: The project's slug.
 *   samples: Sample exports a visitor can load into the paste box.
 */
export function ImportForm({
  slug,
  samples,
}: {
  slug: string;
  samples: { id: string; label: string; content: string }[];
}): ReactElement {
  const [state, formAction, pending] = useActionState<ImportState, FormData>(
    generateImportProposal.bind(null, slug),
    { status: "idle" },
  );
  const roadmapRef = useRef<HTMLTextAreaElement>(null);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Try a sample export:</span>
        {samples.map((sample) => (
          <Button
            key={sample.id}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              roadmapRef.current!.value = sample.content;
            }}
          >
            {sample.label}
          </Button>
        ))}
      </div>
      <label htmlFor="roadmap" className="text-sm font-medium">
        Roadmap
      </label>
      <textarea
        id="roadmap"
        name="roadmap"
        ref={roadmapRef}
        rows={16}
        defaultValue={state.status === "error" ? state.roadmap : ""}
        placeholder="Paste a roadmap, planning notes or a product brief. Markdown and CSV are fine."
        className="w-full rounded-md border border-input bg-transparent p-3 font-mono text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      <div className="flex flex-col gap-1">
        <label htmlFor="file" className="text-sm font-medium">
          Or upload an export
        </label>
        <input
          id="file"
          name="file"
          type="file"
          accept={ROADMAP_FILE_TYPES.join(",")}
          aria-describedby="file-help"
          // Next.js rejects a request over 1 MB before the action can explain why, so check here too.
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.setCustomValidity(
              file && file.size > MAX_ROADMAP_CHARS ? FILE_TOO_LARGE : "",
            );
            event.currentTarget.reportValidity();
          }}
          className="text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-background file:px-2.5 file:py-1 file:text-sm file:font-medium"
        />
        <p id="file-help" className="text-sm text-muted-foreground">
          A Markdown, text, CSV or HTML file up to {MAX_ROADMAP_CHARS / 1000}{" "}
          KB, such as a CSV export from Jira, Productboard, Aha! or Linear, or a
          Markdown export from Notion or Confluence.
        </p>
      </div>
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
