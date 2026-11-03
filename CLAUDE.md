# CLAUDE.md

Context for Claude Code sessions in this repo.

## What this project is

Throughline keeps a product roadmap and a technical roadmap in sync with what engineering actually ships. It links every product outcome to the technical requirements that deliver it, and every requirement to GitHub issues and PRs. When work lands, an agent compares plan against reality and proposes roadmap updates that a person approves. The product view explains the state of the product in plain language for sales and leadership.

This is a public portfolio project. Code quality, tests and docs matter as much as features.

- Architecture and data model: `docs/ARCHITECTURE.md`
- Staged build plan with acceptance criteria: `docs/PLAN.md`

## Design rules (do not break these)

1. **The AI proposes; people decide.** LLM output never writes to the graph directly. It becomes a `Proposal`, and only `applyProposal` changes the graph.
2. **Splits keep the parent link.** Splitting a requirement adds children under it. Never replace or delete the original.
3. **Parent status is computed, never stored.** Only leaf requirements have a `status`. Rollups are pure functions in `src/core/rollup.ts`.
4. **Every graph change writes an event** with an actor and, where relevant, a plain-language `product_note`.
5. **Plain language in the product view.** No ticket numbers, branch names or jargon unless the reader asks for technical detail.
6. **Integrations go through adapters.** GitHub via `SourceAdapter`, LLMs via `LLMProvider`. Core code must not import Octokit or the Anthropic SDK directly.
7. **Everything works without secrets.** With no `ANTHROPIC_API_KEY` or GitHub App credentials, the app falls back to `FakeLLMProvider` and demo data. Tests never call real APIs.

## Stack

Next.js (App Router), TypeScript (strict), Tailwind CSS, shadcn/ui, Drizzle ORM, Postgres (Neon in production, PGlite locally and in tests), Zod, Octokit, Anthropic TypeScript SDK, Vitest, Playwright, GitHub Actions, Vercel. Package manager: pnpm.

## Commands

These are created in Stage 1. Keep this list accurate.

```bash
pnpm dev          # run the app locally
pnpm lint         # ESLint
pnpm typecheck    # tsc --noEmit
pnpm test         # Vitest unit tests
pnpm test:e2e     # Playwright smoke tests
pnpm db:generate  # generate a Drizzle migration from schema changes
pnpm db:migrate   # apply migrations
pnpm db:seed      # seed the Acme Analytics demo project
```

## Layout (target)

```
src/
  app/            Next.js routes and pages
  components/     UI components
  core/           pure domain logic: graph operations, rollup, proposals
  db/             Drizzle schema, migrations, seed
  agents/         import, reconcile, link-suggest agents and prompts
  adapters/       SourceAdapter (github), LLMProvider (anthropic, fake)
  jobs/           enqueue and job runner
tests/            fixtures and e2e tests
docs/             architecture, plan, setup guides
```

## Working conventions

- Work one stage of `docs/PLAN.md` at a time, on a branch named `stage-N-short-name`.
- Keep PRs reviewable. If a stage grows too large, split it into stacked PRs and say so.
- PR description: what was built, how to try it, and `Closes #<issue>`.
- Write tests for any logic in `src/core`, `src/agents` and `src/adapters`. UI gets a Playwright smoke test, not exhaustive tests.
- Validate all external input (webhooks, LLM output, form data) with Zod at the boundary.
- Never commit secrets. Add new environment variables to `.env.example` with a comment.
- Prefer small, readable functions over clever abstractions. The repo owner must be able to explain every part in an interview.
- If you change the data model or a design rule, update `docs/ARCHITECTURE.md` in the same PR.
