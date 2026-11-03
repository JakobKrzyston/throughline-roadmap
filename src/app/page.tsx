import { Button } from "@/components/ui/button";

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
      {/* Stage 7 points this at the Acme Analytics demo project. */}
      <Button size="lg" disabled>
        Open demo
      </Button>
    </main>
  );
}
