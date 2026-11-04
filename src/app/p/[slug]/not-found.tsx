/** Shown when a project page is opened for a project that does not exist. */
import Link from "next/link";
import type { ReactElement } from "react";

import { DEMO_SLUG } from "@/db/seed";

/**
 * Plain-language "no such project" message with a way out.
 *
 * Returns:
 *   The message.
 */
export default function ProjectNotFound(): ReactElement {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col items-start gap-4 px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">
        We could not find that project
      </h1>
      <p className="text-muted-foreground">
        The link may be mistyped, or the project may have been removed.
      </p>
      <Link
        href={`/p/${DEMO_SLUG}`}
        className="font-medium underline underline-offset-4"
      >
        Open the demo project instead
      </Link>
    </div>
  );
}
