/** The note shown in place of forms on a project visitors may not change. Exports ViewOnlyNotice. */
import Link from "next/link";
import type { ReactElement } from "react";

import { DEMO_SLUG } from "@/db/seed";

/**
 * Explain that this public server does not take changes here, and where they can be tried.
 *
 * Returns:
 *   The notice.
 */
export function ViewOnlyNotice(): ReactElement {
  return (
    <p className="rounded-md border border-border bg-muted p-3 text-sm">
      This project is view-only on the public site, because there is no sign-in
      yet. To try importing and reviewing, open the{" "}
      <Link href={`/p/${DEMO_SLUG}`} className="font-medium underline">
        Acme Analytics demo
      </Link>
      .
    </p>
  );
}
