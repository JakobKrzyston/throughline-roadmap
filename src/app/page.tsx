/** The landing page: what Throughline does, a live preview of the demo, and the ways in. */
import {
  Bot,
  Check,
  Code,
  GitPullRequest,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { type ReactElement, Suspense } from "react";

import { LogoMark } from "@/components/logo-mark";
import { buttonVariants } from "@/components/ui/button";
import { DEMO_SLUG } from "@/db/seed";

import { DemoPreview, DemoPreviewSkeleton } from "./demo-preview";

const SOURCE_URL = "https://github.com/JakobKrzyston/throughline-roadmap";

const STEPS: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: GitPullRequest,
    title: "Link the work",
    text: "Every product outcome is broken into technical requirements, and every requirement is linked to the GitHub issues and pull requests that deliver it.",
  },
  {
    icon: Bot,
    title: "Agents compare plan and reality",
    text: "When a pull request merges, an agent reads it next to the plan and proposes an update: done, partly done, split into new pieces, or bigger than planned.",
  },
  {
    icon: Check,
    title: "A person approves",
    text: "Nothing changes until someone approves the proposal. Each approved change carries a plain-language note for the product view.",
  },
];

/**
 * Landing page. The explanation is static; only the preview reads the database.
 *
 * Returns:
 *   The page.
 */
export default function Home(): ReactElement {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-16 px-4 py-12 sm:py-20">
      <section className="flex flex-col items-start gap-6">
        <p className="flex items-center gap-2 text-lg font-semibold">
          <LogoMark />
          Throughline
        </p>
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          One roadmap for product and engineering, kept true by the work that
          ships.
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground">
          Throughline keeps a product roadmap and a technical roadmap of the
          same work, linked to real issues and pull requests. When work lands,
          an AI agent proposes how the roadmap should change, and a person
          approves it.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href={`/p/${DEMO_SLUG}`}
            className={buttonVariants({ size: "lg" })}
          >
            Open demo
          </Link>
          <Link
            href={`/p/${DEMO_SLUG}/review`}
            className={buttonVariants({ variant: "outline", size: "lg" })}
          >
            Try approving a proposal
          </Link>
          <a
            href={SOURCE_URL}
            className={buttonVariants({ variant: "ghost", size: "lg" })}
          >
            <Code aria-hidden="true" />
            View source on GitHub
          </a>
        </div>
        <p className="text-sm text-muted-foreground">
          The demo is Acme Analytics, a sample company. No sign-in needed, and
          it resets every night, so approve or reject anything.
        </p>
      </section>

      <section aria-labelledby="preview" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="preview" className="text-2xl font-semibold tracking-tight">
            The same work, three ways
          </h2>
          <p className="text-muted-foreground">
            Live from the demo: one outcome as sales sees it, as engineering
            sees it, and the change waiting for a person to approve.
          </p>
        </div>
        {/* The preview is read per request; everything else on the page is the static shell. */}
        <Suspense fallback={<DemoPreviewSkeleton />}>
          <DemoPreview />
        </Suspense>
      </section>

      <section aria-labelledby="how" className="flex flex-col gap-6">
        <h2 id="how" className="text-2xl font-semibold tracking-tight">
          How it works
        </h2>
        <ol className="grid gap-6 sm:grid-cols-3">
          {STEPS.map(({ icon: Icon, title, text }) => (
            <li key={title} className="flex flex-col gap-2">
              <Icon className="size-5" aria-hidden="true" />
              <h3 className="font-semibold">{title}</h3>
              <p className="text-sm text-muted-foreground">{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <footer className="flex flex-wrap gap-x-6 gap-y-2 border-t border-border pt-6 text-sm text-muted-foreground">
        <a href={SOURCE_URL} className="hover:text-foreground">
          Source on GitHub
        </a>
        <a
          href={`${SOURCE_URL}/blob/main/docs/ARCHITECTURE.md`}
          className="hover:text-foreground"
        >
          Architecture and data model
        </a>
        <span>Open source, MIT licence</span>
      </footer>
    </main>
  );
}
