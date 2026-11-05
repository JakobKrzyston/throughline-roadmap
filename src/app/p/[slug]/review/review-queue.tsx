"use client";
/** The list of pending proposals, deciding one at a time and confirming each decision in place. Exports ReviewQueue, DecidedView. */
import { Check, X } from "lucide-react";
import Link from "next/link";
import {
  type ReactElement,
  useActionState,
  useEffect,
  useRef,
  useState,
} from "react";

import { type DecideState, decideProposal } from "./actions";
import { ProposalCard, type ProposalView } from "./proposal-card";

/** A proposal someone approved or rejected, as the page lists it under "Recently decided". */
export type DecidedView = {
  id: string;
  summary: string;
  sourceLabel: string;
  approved: boolean;
  decidedBy: string;
  decidedOn: string;
  /** Where an approved change shows, e.g. the technical view. */
  where?: { href: string; label: string };
};

/**
 * The pending proposals with one shared decision form state.
 *
 * Sharing it means every Approve and Reject button is disabled while any decision is in flight,
 * and the confirmation survives the refresh that removes the decided card.
 *
 * Args:
 *   slug: The project's slug.
 *   proposals: The pending proposals, newest first.
 *   decided: The recently decided proposals, so a confirmation can name the one just decided.
 *   viewOnly: True to show the proposals without the decision buttons.
 *   canEdit: False to offer approve and reject only.
 *
 * Returns:
 *   The queue.
 */
export function ReviewQueue({
  slug,
  proposals,
  decided,
  viewOnly,
  canEdit,
}: {
  slug: string;
  proposals: ProposalView[];
  decided: DecidedView[];
  viewOnly: boolean;
  canEdit: boolean;
}): ReactElement {
  const [state, formAction, pending] = useActionState<DecideState, FormData>(
    decideProposal.bind(null, slug),
    { status: "idle" },
  );
  // Where the last submitted card was, so its confirmation can take its place.
  const [decidingAt, setDecidingAt] = useState(0);
  // A link to #proposal-<id> (from the feedback page) arrives before this list has streamed in,
  // so the browser found nothing to scroll to; scroll once the cards exist.
  useEffect(() => {
    if (location.hash) {
      document.getElementById(location.hash.slice(1))?.scrollIntoView();
    }
  }, []);
  const justDecided =
    state.status === "decided"
      ? decided.find((view) => view.id === state.proposalId)
      : undefined;

  const items = proposals.map((proposal, i) => (
    <li key={proposal.id}>
      <ProposalCard
        proposal={proposal}
        formAction={formAction}
        onSubmit={() => setDecidingAt(i)}
        pending={pending}
        error={
          state.status === "error" && state.proposalId === proposal.id
            ? state.message
            : undefined
        }
        viewOnly={viewOnly}
        canEdit={canEdit}
      />
    </li>
  ));
  if (justDecided) {
    // In the decided card's place, so the next card's buttons do not move up under the pointer.
    items.splice(
      decidingAt,
      0,
      <li key={`decided-${justDecided.id}`}>
        <Confirmation decided={justDecided} />
      </li>,
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {items.length > 0 && <ol className="flex flex-col gap-6">{items}</ol>}
      {proposals.length === 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          <p className="font-medium text-foreground">
            {justDecided ? "That was the last one." : "Nothing to review."}
          </p>
          <p>
            Proposals appear here when you{" "}
            <Link href={`/p/${slug}/import`} className="underline">
              import a roadmap
            </Link>
            , when linked work ships, when a target looks at risk, and when
            customer feedback matches an outcome.
          </p>
        </div>
      )}
    </div>
  );
}

function Confirmation({ decided }: { decided: DecidedView }): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  // Focus moves here from the button that just left the page.
  useEffect(() => ref.current?.focus(), []);
  const Icon = decided.approved ? Check : X;
  return (
    <div
      role="status"
      tabIndex={-1}
      ref={ref}
      className="flex items-start gap-3 rounded-lg border border-border bg-muted p-4 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <Icon
        aria-hidden
        className={`mt-0.5 size-4 shrink-0 ${decided.approved ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}`}
      />
      <p className="min-w-0 break-words">
        <span className="font-medium">
          {decided.approved ? "Approved" : "Rejected"}: {decided.summary}.
        </span>{" "}
        {decided.where ? (
          <>
            The roadmap is updated; see it in the{" "}
            <Link href={decided.where.href} className="underline">
              {decided.where.label}
            </Link>
            .
          </>
        ) : (
          "Nothing on the roadmap changed."
        )}{" "}
        It is listed under Recently decided below.
      </p>
    </div>
  );
}
