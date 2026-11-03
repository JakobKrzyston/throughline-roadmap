# Throughline

Traces every PR back to a customer-facing outcome, even after a requirement has split into several pieces.

> **Status:** in development. The plan is public: see [`docs/PLAN.md`](docs/PLAN.md) and the [issues](../../issues).

## What it does

Product roadmaps and engineering work drift apart. A requirement turns out to need four pieces of work instead of one, something ships differently than planned, and soon nobody outside engineering can say what customers can actually use today.

Throughline keeps them connected:

- **One source of truth.** Product outcomes, technical requirements and GitHub issues and PRs live in one linked graph. The product roadmap and the technical roadmap are two views of it.
- **Plan versus reality.** When a PR merges, an AI agent compares what was built with what was planned and proposes updates: mark it done, split it, or record that scope grew.
- **People stay in charge.** Nothing changes until a product manager approves the proposal.
- **Plain-language status.** Sales and leadership see what is delivered, what is partially available, and why plans changed, without reading tickets.

## Run it locally

You need Node.js 22 and pnpm (`corepack enable pnpm`).

```bash
pnpm install
pnpm db:migrate   # create the tables
pnpm db:seed      # load the "Acme Analytics" demo project
pnpm dev
```

Open http://localhost:3000. No environment variables are needed: the app stores data in an embedded Postgres (PGlite) under `./.pglite`. To use a Postgres server such as Neon, copy `.env.example` to `.env.local` and set `DATABASE_URL`.

Checks that CI runs on every pull request:

```bash
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test
```

## Learn more

- [Architecture and data model](docs/ARCHITECTURE.md)
- [Build plan](docs/PLAN.md)

## License

MIT. See [LICENSE](LICENSE).
