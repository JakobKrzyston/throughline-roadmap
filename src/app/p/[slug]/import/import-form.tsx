"use client";
/** The import page's form: paste box, file upload, sample exports and "Generate proposal" button. Exports ImportForm. */
import Link from "next/link";
import { type ReactElement, useActionState, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  FILE_EMPTY,
  FILE_TOO_LARGE,
  MAX_FILE_BYTES,
  ROADMAP_FILE_TYPES,
} from "@/lib/roadmap-input";

import {
  generateImportProposal,
  type ImportState,
  loadImportSample,
} from "./actions";

/**
 * Form that sends a pasted or uploaded roadmap to the import agent and links to the resulting proposal.
 *
 * The form holds either text or a file, never both: whichever the person uses last (typing,
 * loading a sample or choosing a file) clears the other.
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
  samples: { id: string; label: string }[];
}): ReactElement {
  const [state, formAction, pending] = useActionState<ImportState, FormData>(
    generateImportProposal.bind(null, slug),
    { status: "idle" },
  );
  const roadmapRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [sampleError, setSampleError] = useState<string | null>(null);
  // Counts sample loads and edits, so a sample that arrives after a newer click or edit is dropped.
  const latestChange = useRef(0);

  function clearFile(): void {
    fileRef.current!.value = "";
    setFileError(null);
  }

  async function loadSample(id: string): Promise<void> {
    const change = ++latestChange.current;
    clearFile();
    setSampleError(null);
    try {
      const text = await loadImportSample(id);
      if (change === latestChange.current) roadmapRef.current!.value = text;
    } catch {
      if (change === latestChange.current) {
        setSampleError("That sample could not be loaded. Please try again.");
      }
    }
  }

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
            onClick={() => loadSample(sample.id)}
          >
            {sample.label}
          </Button>
        ))}
        <p aria-live="polite" className="text-destructive">
          {sampleError}
        </p>
      </div>
      <label htmlFor="roadmap" className="text-sm font-medium">
        Roadmap
      </label>
      <textarea
        id="roadmap"
        name="roadmap"
        ref={roadmapRef}
        onChange={() => {
          latestChange.current++;
          setSampleError(null);
          if (fileRef.current!.value) clearFile();
        }}
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
          ref={fileRef}
          aria-describedby="file-help file-error"
          // Next.js rejects a request over 1 MB before the action can explain why, and the server
          // cannot tell a 0-byte file from no file, so both are checked here. A bad file is cleared
          // rather than marked invalid, since some browsers cannot clear a file input.
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            let error: string | null = null;
            if (file && file.size > MAX_FILE_BYTES) error = FILE_TOO_LARGE;
            else if (file && file.size === 0) error = FILE_EMPTY;
            setFileError(error);
            if (error) {
              event.currentTarget.value = "";
            } else if (file) {
              latestChange.current++;
              setSampleError(null);
              roadmapRef.current!.value = "";
            }
          }}
          className="text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-background file:px-2.5 file:py-1 file:text-sm file:font-medium"
        />
        <p id="file-help" className="text-sm text-muted-foreground">
          A Markdown, text, CSV or HTML file up to {MAX_FILE_BYTES / 1000} KB,
          such as a CSV export from Jira, Productboard, Aha! or Linear, or a
          Markdown export from Notion or Confluence.
        </p>
        <p
          id="file-error"
          aria-live="polite"
          className="text-sm text-destructive"
        >
          {fileError}
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
