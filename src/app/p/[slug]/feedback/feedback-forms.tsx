"use client";
/** The feedback page's controls: link a piece of feedback to an outcome, or unlink it. Exports LinkFeedbackForm, UnlinkFeedbackButton. */
import { type ReactElement, useActionState, useId } from "react";

import { Button } from "@/components/ui/button";

import { type FeedbackState, linkFeedback, unlinkFeedback } from "./actions";

const IDLE: FeedbackState = { status: "idle" };

/**
 * An outcome picker and a Link button for one piece of feedback.
 *
 * Args:
 *   slug: The project's slug.
 *   feedbackId: The feedback to link.
 *   feedbackTitle: Its title, for the picker's accessible name.
 *   outcomes: Live outcomes to choose from.
 */
export function LinkFeedbackForm({
  slug,
  feedbackId,
  feedbackTitle,
  outcomes,
}: {
  slug: string;
  feedbackId: string;
  feedbackTitle: string;
  outcomes: { key: string; title: string }[];
}): ReactElement {
  const [state, action, pending] = useActionState(
    linkFeedback.bind(null, slug, feedbackId),
    IDLE,
  );
  const id = useId();
  return (
    <form
      action={action}
      className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0"
    >
      <label htmlFor={id} className="sr-only">
        Outcome for “{feedbackTitle}”
      </label>
      {/* A select is as wide as its longest option unless its width is set, which made phones scroll sideways. */}
      <select
        id={id}
        name="outcome"
        defaultValue=""
        className="h-7 min-w-0 flex-1 basis-0 rounded-md border border-input bg-transparent px-2 text-sm sm:w-56 sm:flex-none sm:basis-auto"
      >
        <option value="" disabled>
          Choose an outcome…
        </option>
        {outcomes.map((outcome) => (
          <option key={outcome.key} value={outcome.key}>
            {outcome.title}
          </option>
        ))}
      </select>
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={pending}
        aria-label={`Link “${feedbackTitle}”`}
      >
        {pending ? "Linking…" : "Link"}
      </Button>
      <Message state={state} />
    </form>
  );
}

/**
 * An Unlink button for feedback linked to an outcome.
 *
 * Args:
 *   slug: The project's slug.
 *   feedbackId: The feedback to unlink.
 *   outcomeKey: The outcome it is linked to.
 *   feedbackTitle: Its title, for the button's accessible name.
 */
export function UnlinkFeedbackButton({
  slug,
  feedbackId,
  outcomeKey,
  feedbackTitle,
}: {
  slug: string;
  feedbackId: string;
  outcomeKey: string;
  feedbackTitle: string;
}): ReactElement {
  const [state, action, pending] = useActionState(
    () => unlinkFeedback(slug, feedbackId, outcomeKey),
    IDLE,
  );
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <Button
        type="submit"
        size="sm"
        variant="ghost"
        disabled={pending}
        aria-label={`Unlink “${feedbackTitle}”`}
      >
        {pending ? "Unlinking…" : "Unlink"}
      </Button>
      <Message state={state} />
    </form>
  );
}

function Message({ state }: { state: FeedbackState }): ReactElement {
  return (
    <span aria-live="polite" className="text-sm text-destructive">
      {state.status === "error" ? state.message : null}
    </span>
  );
}
