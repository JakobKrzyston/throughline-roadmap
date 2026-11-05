/** The site-wide 404 page for any URL that matches no route. */
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactElement } from "react";

import { LogoMark } from "@/components/logo-mark";
import { buttonVariants } from "@/components/ui/button";
import { DEMO_SLUG } from "@/db/seed";

export const metadata: Metadata = { title: "Page not found" };

/**
 * Branded "page not found" message with the ways back.
 *
 * Returns:
 *   The page.
 */
export default function NotFound(): ReactElement {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col items-start gap-6 px-4 py-16 sm:py-24">
      <Link href="/" className="flex items-center gap-2 text-lg font-semibold">
        <LogoMark />
        Throughline
      </Link>
      <h1 className="text-3xl font-semibold tracking-tight">
        We could not find that page
      </h1>
      <p className="text-muted-foreground">
        The link may be mistyped, or the page may have moved.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link href="/" className={buttonVariants({ size: "lg" })}>
          Go to the home page
        </Link>
        <Link
          href={`/p/${DEMO_SLUG}`}
          className={buttonVariants({ variant: "outline", size: "lg" })}
        >
          Open the demo
        </Link>
      </div>
    </main>
  );
}
