"use client";
/** Switches the import page between one roadmap and a product and technical roadmap together. Exports ImportModes. */
import { type ReactElement, useState } from "react";

import { ImportForm } from "./import-form";
import { PairedImportForm } from "./paired-import-form";

const MODES = [
  { id: "single", label: "One roadmap" },
  { id: "paired", label: "Product and technical roadmap" },
] as const;

/**
 * The two import forms with a choice between them. Only the chosen form is on the page.
 *
 * Args:
 *   slug: The project's slug.
 *   samples: Sample exports the one-roadmap form offers.
 *
 * Returns:
 *   The mode choice and the chosen form.
 */
export function ImportModes({
  slug,
  samples,
}: {
  slug: string;
  samples: { id: string; label: string }[];
}): ReactElement {
  const [mode, setMode] = useState<(typeof MODES)[number]["id"]>("single");
  return (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <legend className="mb-2 font-medium">What are you importing?</legend>
        {MODES.map(({ id, label }) => (
          <label key={id} className="flex items-center gap-2">
            <input
              type="radio"
              name="import-mode"
              value={id}
              checked={mode === id}
              onChange={() => setMode(id)}
            />
            {label}
          </label>
        ))}
      </fieldset>
      {mode === "single" ? (
        <ImportForm slug={slug} samples={samples} />
      ) : (
        <div>
          <p className="mb-4 text-sm text-muted-foreground">
            Bring both and get one proposal that links each technical item to
            the product outcome it delivers. You check every link before
            anything is saved.
          </p>
          <PairedImportForm slug={slug} />
        </div>
      )}
    </div>
  );
}
