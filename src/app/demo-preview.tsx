/** The landing page's live preview: one demo outcome as the product view, the technical view and the review queue show it. Exports DemoPreview, DemoPreviewSkeleton. */
import { and, desc, eq } from "drizzle-orm";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import type { ReactElement, ReactNode } from "react";

import { Badge, type BadgeTone } from "@/components/badge";
import { PRODUCT_STATUS_TEXT } from "@/core/product-text";
import {
  availableToday,
  loadRoadmap,
  type OutcomeTree,
  type RequirementTree,
} from "@/core/roadmap";
import { outcomeProgress, productStatus } from "@/core/rollup";
import { getDb } from "@/db/client";
import { projects, proposals } from "@/db/schema";
import { DEMO_SLUG } from "@/db/seed";

import { STATUS_TONE, StatusProgressBar } from "./p/[slug]/outcome-card";

const DEMO = `/p/${DEMO_SLUG}`;

const LEAF_STATUS: Record<
  NonNullable<RequirementTree["status"]>,
  { label: string; tone: BadgeTone }
> = {
  planned: { label: "Planned", tone: "neutral" },
  in_progress: { label: "In progress", tone: "amber" },
  done: { label: "Done", tone: "green" },
  dropped: { label: "Dropped", tone: "neutral" },
};

interface Preview {
  outcome: OutcomeTree;
  pendingCount: number;
  proposal: { summary: string; rationale: string } | null;
}

/**
 * Read the demo's most telling outcome and the proposal waiting on it.
 *
 * Returns:
 *   The first partially available outcome (else the first outcome), the number of pending
 *   proposals, and the newest one about that outcome (else the newest one). Null when the demo
 *   project does not exist or has no outcomes yet.
 */
async function loadPreview(): Promise<Preview | null> {
  const db = getDb();
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, DEMO_SLUG));
  if (!project) return null;

  const roadmap = await loadRoadmap(db, project.id);
  const outcome =
    roadmap.find(
      (o) => productStatus(o.requirements) === "partially_available",
    ) ?? roadmap[0];
  if (!outcome) return null;

  const pending = await db
    .select({
      summary: proposals.summary,
      rationale: proposals.rationale,
      requirementId: proposals.requirementId,
    })
    .from(proposals)
    .where(
      and(eq(proposals.projectId, project.id), eq(proposals.status, "pending")),
    )
    .orderBy(desc(proposals.createdAt));
  const ids = new Set(requirementIds(outcome.requirements));
  const proposal =
    pending.find((p) => p.requirementId && ids.has(p.requirementId)) ??
    pending[0] ??
    null;
  return { outcome, pendingCount: pending.length, proposal };
}

function requirementIds(nodes: RequirementTree[]): string[] {
  return nodes.flatMap((node) => [node.id, ...requirementIds(node.children)]);
}

/**
 * Live preview of the demo, read per request.
 *
 * Returns:
 *   Three panels showing one outcome, or a short note when the demo is missing or unreadable.
 */
export async function DemoPreview(): Promise<ReactElement> {
  // The database read is uncached, so render this part per request rather than prerendering it.
  await connection();
  let preview: Preview | null;
  try {
    preview = await loadPreview();
  } catch (error) {
    // The landing page must still explain the product when the database is unreachable.
    console.error(error);
    preview = null;
  }

  if (!preview) {
    return (
      <p className="rounded-xl border border-border bg-card p-6 text-center text-muted-foreground">
        The live preview is not available right now. Try again in a minute.
      </p>
    );
  }

  const { outcome, pendingCount, proposal } = preview;
  const statusKey = productStatus(outcome.requirements);
  const percent = Math.round(outcomeProgress(outcome.requirements) * 100);
  const available = availableToday(outcome.requirements);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Panel
        title="Product view"
        audience="For sales and leadership"
        href={DEMO}
        cta="Open the product view"
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 className="font-semibold">{outcome.title}</h3>
          <Badge tone={STATUS_TONE[statusKey]}>
            {PRODUCT_STATUS_TEXT[statusKey].label}
          </Badge>
        </div>
        <div className="flex items-center gap-3">
          <StatusProgressBar
            label={`Progress on ${outcome.title}`}
            percent={percent}
            status={statusKey}
            className="flex-1"
          />
          <span className="text-sm text-muted-foreground">{percent}%</span>
        </div>
        <p className="text-sm">{PRODUCT_STATUS_TEXT[statusKey].summary}</p>
        {available.length > 0 && (
          <ul className="list-disc pl-5 text-sm">
            {available.map((item) => (
              <li key={item.key}>{item.text}</li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="Technical view"
        audience="For engineering"
        href={`${DEMO}/tech`}
        cta="Open the technical view"
      >
        <RequirementRows requirements={outcome.requirements} />
      </Panel>

      <Panel
        title="Review queue"
        audience="A person decides"
        href={`${DEMO}/review`}
        cta="Open the review queue"
      >
        {proposal ? (
          <>
            <p className="text-sm text-muted-foreground">
              An agent read the merged work and proposes:
            </p>
            <div className="flex flex-col gap-1 rounded-lg bg-muted p-3">
              <p className="font-semibold">{proposal.summary}</p>
              <p className="line-clamp-3 text-sm text-muted-foreground">
                {proposal.rationale}
              </p>
            </div>
            <p className="text-sm">
              Nothing changes until someone approves it.{" "}
              {pendingCount > 1 &&
                `${pendingCount - 1} more ${pendingCount === 2 ? "proposal is" : "proposals are"} waiting.`}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nothing is waiting for review right now. When work merges, an agent
            proposes how the roadmap should change, and it waits here for a
            person.
          </p>
        )}
      </Panel>
    </div>
  );
}

function RequirementRows({
  requirements,
}: {
  requirements: RequirementTree[];
}): ReactElement {
  return (
    <ul className="flex flex-col gap-1.5 border-l border-border pl-3">
      {requirements.map((requirement) => {
        const status = requirement.status
          ? LEAF_STATUS[requirement.status]
          : null;
        const pullRequests = requirement.workItems.filter(
          (item) => item.kind === "pull_request",
        );
        return (
          <li key={requirement.id} className="flex flex-col gap-1.5 text-sm">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-mono text-xs text-muted-foreground">
                {requirement.key}
              </span>
              <span className="font-medium">{requirement.title}</span>
              {status && <Badge tone={status.tone}>{status.label}</Badge>}
            </div>
            {pullRequests.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {pullRequests
                  .map((item) => `PR #${item.number} ${item.state}`)
                  .join(" · ")}
              </p>
            )}
            {requirement.children.length > 0 && (
              <RequirementRows requirements={requirement.children} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Panel({
  title,
  audience,
  href,
  cta,
  children,
}: {
  title: string;
  audience: string;
  href: string;
  cta: string;
  children: ReactNode;
}): ReactElement {
  return (
    <section
      aria-label={title}
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5 text-card-foreground"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold tracking-wide uppercase">
          {title}
        </h3>
        <span className="text-xs text-muted-foreground">{audience}</span>
      </div>
      <div className="flex flex-1 flex-col gap-3">{children}</div>
      <Link
        href={href}
        className="inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
      >
        {cta}
        <ArrowRight className="size-4" aria-hidden="true" />
      </Link>
    </section>
  );
}

/**
 * Placeholder with the preview's shape while it loads, so the page does not jump.
 *
 * Returns:
 *   Three empty panels.
 */
export function DemoPreviewSkeleton(): ReactElement {
  return (
    <div className="grid gap-4 lg:grid-cols-3" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="flex h-72 flex-col gap-3 rounded-xl border border-border bg-card p-5"
        >
          <div className="h-3 w-24 animate-pulse rounded bg-muted" />
          <div className="h-5 w-3/4 animate-pulse rounded bg-muted" />
          <div className="h-2 w-full animate-pulse rounded bg-muted" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}
