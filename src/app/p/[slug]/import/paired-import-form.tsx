"use client";
/** The import page's "Product and technical roadmap" form: two inputs, each a paste box or a file, sent together for one proposal. Exports PairedImportForm. */
import Link from "next/link";
import { type ReactElement, useActionState, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  FILE_EMPTY,
  FILE_TOO_LARGE,
  MAX_FILE_BYTES,
  MAX_PAIRED_FILE_BYTES,
  PAIRED_FILES_TOO_LARGE,
  ROADMAP_FILE_TYPES,
} from "@/lib/roadmap-input";

import {
  generatePairedImportProposal,
  loadPairedSample,
  type PairedImportState,
} from "./actions";

type Side = "product" | "technical";

const SIDES: { side: Side; label: string; placeholder: string }[] = [
  {
    side: "product",
    label: "Product roadmap",
    placeholder:
      "Paste the product roadmap: what customers will get, one item per row or line.",
  },
  {
    side: "technical",
    label: "Technical roadmap",
    placeholder:
      "Paste the technical roadmap: the epics, stories and tasks engineering plans.",
  },
];

/**
 * Form that sends a product roadmap and a technical roadmap to the paired import agent and links
 * to the resulting proposal.
 *
 * Each input holds text or a file, never both, as in the one-roadmap form. The two files together
 * must stay within MAX_PAIRED_FILE_BYTES, because Next.js rejects a larger request before the
 * action can explain why, so a file that would take the total over is refused here.
 *
 * Args:
 *   slug: The project's slug.
 *
 * Returns:
 *   The form.
 */
export function PairedImportForm({ slug }: { slug: string }): ReactElement {
  const [state, formAction, pending] = useActionState<
    PairedImportState,
    FormData
  >(generatePairedImportProposal.bind(null, slug), { status: "idle" });
  const formRef = useRef<HTMLFormElement>(null);
  const [fileErrors, setFileErrors] = useState<Record<Side, string | null>>({
    product: null,
    technical: null,
  });
  const [sampleError, setSampleError] = useState<string | null>(null);
  // Counts sample loads and edits, so a sample that arrives after a newer edit is dropped.
  const latestChange = useRef(0);

  const setFileError = (side: Side, error: string | null): void =>
    setFileErrors((errors) => ({ ...errors, [side]: error }));

  async function loadSample(): Promise<void> {
    const change = ++latestChange.current;
    setSampleError(null);
    const form = formRef.current!;
    for (const { side } of SIDES) {
      fileInput(form, side).value = "";
      setFileError(side, null);
    }
    try {
      const sample = await loadPairedSample();
      if (change === latestChange.current) {
        pasteBox(form, "product").value = sample.product;
        pasteBox(form, "technical").value = sample.technical;
      }
    } catch {
      if (change === latestChange.current) {
        setSampleError("The sample could not be loaded. Please try again.");
      }
    }
  }

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Try a sample:</span>
        <Button type="button" variant="outline" size="sm" onClick={loadSample}>
          Acme product and Jira CSVs
        </Button>
        <p aria-live="polite" className="text-destructive">
          {sampleError}
        </p>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        {SIDES.map(({ side, label, placeholder }) => (
          <RoadmapField
            key={side}
            side={side}
            label={label}
            placeholder={placeholder}
            defaultValue={state.status === "error" ? state[side] : ""}
            fileError={fileErrors[side]}
            onFileError={(error) => setFileError(side, error)}
            onEdit={() => {
              latestChange.current++;
              setSampleError(null);
            }}
          />
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        Each can be a Markdown, text, CSV or HTML file up to{" "}
        {MAX_FILE_BYTES / 1000} KB, and the two together up to{" "}
        {MAX_PAIRED_FILE_BYTES / 1000} KB. Excel users can save as CSV.
      </p>
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

// The form's own fields, looked up by name, so neither input needs a ref of its own.
function pasteBox(form: HTMLFormElement, side: Side): HTMLTextAreaElement {
  return form.elements.namedItem(`${side}_roadmap`) as HTMLTextAreaElement;
}

function fileInput(form: HTMLFormElement, side: Side): HTMLInputElement {
  return form.elements.namedItem(`${side}_file`) as HTMLInputElement;
}

function RoadmapField({
  side,
  label,
  placeholder,
  defaultValue,
  fileError,
  onFileError,
  onEdit,
}: {
  side: Side;
  label: string;
  placeholder: string;
  defaultValue: string;
  fileError: string | null;
  onFileError: (error: string | null) => void;
  onEdit: () => void;
}): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label htmlFor={`${side}_roadmap`} className="text-sm font-medium">
        {label}
      </label>
      <textarea
        id={`${side}_roadmap`}
        name={`${side}_roadmap`}
        onChange={(event) => {
          onEdit();
          const file = fileInput(event.currentTarget.form!, side);
          if (file.value) {
            file.value = "";
            onFileError(null);
          }
        }}
        rows={12}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="w-full rounded-md border border-input bg-transparent p-3 font-mono text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      <label htmlFor={`${side}_file`} className="text-sm font-medium">
        Or upload the {label.toLowerCase()}
      </label>
      <input
        id={`${side}_file`}
        name={`${side}_file`}
        type="file"
        accept={ROADMAP_FILE_TYPES.join(",")}
        aria-describedby={`${side}_file-error`}
        // As in the one-roadmap form, a bad file is cleared rather than marked invalid.
        onChange={(event) => {
          const form = event.currentTarget.form!;
          const file = event.currentTarget.files?.[0];
          const other = side === "product" ? "technical" : "product";
          const otherBytes = fileInput(form, other).files?.[0]?.size ?? 0;
          let error: string | null = null;
          if (file && file.size > MAX_FILE_BYTES) error = FILE_TOO_LARGE;
          else if (file && file.size === 0) error = FILE_EMPTY;
          else if (file && file.size + otherBytes > MAX_PAIRED_FILE_BYTES) {
            error = PAIRED_FILES_TOO_LARGE;
          }
          onFileError(error);
          if (error) {
            event.currentTarget.value = "";
          } else if (file) {
            onEdit();
            pasteBox(form, side).value = "";
          }
        }}
        className="text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-background file:px-2.5 file:py-1 file:text-sm file:font-medium"
      />
      <p
        id={`${side}_file-error`}
        aria-live="polite"
        className="text-sm text-destructive"
      >
        {fileError}
      </p>
    </div>
  );
}
