import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { DEMO_SLUG } from "@/db/seed";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-24 text-center">
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
        Throughline
      </h1>
      <p className="max-w-xl text-lg text-muted-foreground">
        Keeps your product roadmap and technical roadmap in sync with what
        engineering ships.
      </p>
      <Link href={`/p/${DEMO_SLUG}`} className={buttonVariants({ size: "lg" })}>
        Open demo
      </Link>
      <p className="max-w-md text-sm text-muted-foreground">
        A sample company&rsquo;s roadmap. No sign-in needed; try approving a
        proposal. It resets every night.
      </p>
    </main>
  );
}
