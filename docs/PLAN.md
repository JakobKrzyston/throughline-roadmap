# Build plan

Throughline v1 is built in seven stages. Each stage is one GitHub issue and one pull request. A stage is done when its acceptance criteria pass and CI is green.

Read `docs/ARCHITECTURE.md` before starting any stage.

**Workflow for every stage**

1. Branch from `main` as `stage-N-short-name`.
2. Build only what the stage describes. Note anything out of scope as a follow-up issue instead of building it.
3. Add or update tests for any logic.
4. Open a PR titled `Stage N: <name>` whose description says what was built, how to try it, and `Closes #<issue>`.
5. Update docs if anything in `ARCHITECTURE.md` changed.

---

## Stage 1: Project scaffold and CI

Set up the app skeleton and tooling so every later stage has a working base.

**Build**

- Next.js (App Router) + TypeScript in strict mode, using pnpm.
- Tailwind CSS and shadcn/ui.
- ESLint and Prettier.
- Vitest with one sample test.
- Drizzle ORM configured for PGlite locally and in tests, and for Postgres (Neon) when `DATABASE_URL` is set.
- `.env.example` listing every environment variable with a comment, all optional at this stage.
- GitHub Actions workflow running lint, typecheck and tests on every PR.
- A home page with the Throughline name, one-line description and a placeholder "Open demo" button.

**Acceptance criteria**

- `pnpm install && pnpm dev` runs the app with no environment variables set.
- `pnpm lint`, `pnpm typecheck` and `pnpm test` all pass.
- CI runs on the PR and is green.
- `CLAUDE.md` commands section matches the real scripts.

---

## Stage 2: Graph core, rollup logic and demo seed

Implement the data model and the logic that makes the roadmaps trustworthy.

**Build**

- Drizzle schema and migration for `projects`, `outcomes`, `requirements`, `work_items`, `links`, `proposals`, `events` and `jobs`, as specified in `ARCHITECTURE.md`.
- Database constraint: a requirement has exactly one of `outcome_id` or `parent_id`.
- Zod schemas for every graph operation.
- `applyProposal(proposalId, actor)`: validates operations, applies them in one transaction, writes one event per operation, marks the proposal approved.
- `src/core/rollup.ts`: pure functions for leaf, parent and outcome progress and for product status (`not_started`, `in_progress`, `partially_available`, `delivered`).
- `pnpm db:seed` creating the "Acme Analytics" demo project: 4–5 outcomes, about 20 requirements including at least two splits, about 25 work items, and a few pending proposals.

**Acceptance criteria**

- Unit tests cover rollup for: a single leaf, nested splits, dropped leaves, `partially_available` versus `in_progress`, and an empty outcome.
- Tests show `split_requirement` keeps the parent's link to its outcome and turns the parent's status to null.
- Tests show a rejected proposal changes nothing.
- Seed runs on a fresh PGlite database without errors.

---

## Stage 3: Roadmap import agent

Turn a pasted roadmap into a proposed graph.

**Build**

- `LLMProvider` interface with `generateStructured(schema, prompt)`.
- `AnthropicProvider` using the Anthropic TypeScript SDK and tool use. Model set by `ANTHROPIC_MODEL`, defaulting to `claude-sonnet-5-5`.
- `FakeLLMProvider` that returns fixtures, used in tests and demo mode.
- Import agent: text or Markdown in, one proposal out containing `create_outcome` and `create_requirement` operations.
- `/p/[slug]/import` page: paste box, "Generate proposal" button, then a link to the proposal in the review queue.

**Acceptance criteria**

- With no `ANTHROPIC_API_KEY`, import uses the fake provider and still works end to end.
- Agent output that fails Zod validation is retried once, then shown as a clear error. It is never partially applied.
- A test checks that the import agent's prompt and schema produce valid operations from a fixture.

---

## Stage 4: GitHub sync

Bring real engineering activity into the graph.

**Build**

- GitHub App setup documented in `docs/GITHUB_APP.md`, with the exact permissions and events.
- `SourceAdapter` interface and a `GitHubAdapter` using Octokit.
- Connect-a-repo flow on the project settings page.
- Backfill: open issues plus PRs merged in the last 90 days.
- `POST /api/github/webhook` with signature verification, work item upsert and explicit link parsing (`Implements TL-12`, `Part of TL-12`).
- Minimal job queue: `enqueue()`, `POST /api/jobs/run`, and a Vercel cron entry.

**Acceptance criteria**

- Webhooks with a bad signature are rejected with 401.
- Link parsing is unit tested, including several references in one PR, lowercase keys and keys that don't exist.
- Merging a PR that references a requirement enqueues a reconciliation job.
- Replaying the same webhook twice does not create duplicates.

---

## Stage 5: Reconciliation agent and review queue

Compare what was planned with what was built, and let a person decide.

**Build**

- Reconciliation agent as described in `ARCHITECTURE.md`, with the four classifications.
- Context builder that caps diff size and summarises changed files.
- Link suggestion agent for merged PRs with no reference.
- `/p/[slug]/review` page: pending proposals with summary, rationale and a readable diff. Approve, edit then approve, or reject.
- Every reconciliation proposal includes a plain-language product note.

**Acceptance criteria**

- Fixture tests for each classification: fully done, partially done, done differently and scope grew.
- Nothing in the graph changes until a proposal is approved.
- Approving a split proposal updates both views correctly, as shown by a test.
- A newer proposal for the same requirement marks older pending ones `superseded`.

---

## Stage 6: Product and technical views

Make the state of the product clear to every audience.

**Build**

- Product view `/p/[slug]`: outcome cards with progress, product status in words, target, and a "What changed this week" feed from events. Ticket numbers hidden behind a "Show technical detail" toggle.
- Technical view `/p/[slug]/tech`: expandable outcome → requirement → child → work item tree, state badges, split history.
- Empty states, loading states and error states written in plain language.
- Responsive layout down to phone width; keyboard navigation; WCAG AA contrast.

**Acceptance criteria**

- A non-technical reader can answer "what can customers use today?" from the product view alone. Check this with someone outside engineering if possible.
- The product view shows no ticket numbers or branch names until the toggle is used.
- A Playwright smoke test loads both views for the demo project.

---

## Stage 7: Demo mode, docs, deploy and dogfooding

Ship it publicly and prove it works on itself.

**Build**

- Demo mode: "Open demo" on the home page goes straight to Acme Analytics with no sign-in. Demo resets nightly.
- Deploy to Vercel with Neon Postgres. Document the steps in `docs/DEPLOY.md`.
- README rewrite: a plain-language "What Throughline does" section with a GIF and screenshots of both views, then "How it works", architecture link, local setup, design decisions, a "Built with Claude" note, and the future work list.
- Dogfooding: create a Throughline project for this repo, import this plan, and connect the repo so the tool tracks its own roadmap. Link it from the README.

**Acceptance criteria**

- The public demo URL works in a private browser window with no sign-in.
- A fresh clone can follow the README to a running local app in under 10 minutes.
- The Throughline project for this repo shows stages 1–7 as delivered.

---

## Future work

Designed for, not built in v1. Each has a `future` issue.

- **Feedback ingestion**: GitHub issues labelled `feedback` first, then support and CRM sources. Feedback is clustered and linked to outcomes so you can see customer pull per outcome, and unmatched feedback flags gaps.
- **Research agent**: a scheduled agent that checks planned technical approaches against current libraries and best practice, and watches the product landscape. Findings appear as comments on graph nodes.
- **More sources**: Linear and Jira `SourceAdapter` implementations.
- **Teams and permissions**: organisations, roles (viewer, PM, admin) and SSO.
- **Digests**: a weekly plain-language summary to Slack or email for non-technical stakeholders. Slack is built, weekly and on milestones, releases and demand (see "Digests" in `ARCHITECTURE.md`); email is still to come.
