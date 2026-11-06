# Build plan

Throughline v1 was built in seven stages; stages 8 and onward extend it. Each stage is one GitHub issue and one pull request. A stage is done when its acceptance criteria pass and CI is green.

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
- Later addition: upload an exported `.md`, `.txt`, `.csv` or `.html` file instead of pasting, and "Try a sample" buttons that load a realistic Jira, Productboard or Notion export. Live Jira and Linear connectors are under "More sources" in Future work.

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

## Stage 8: Import both roadmaps together

Teams that already keep a product roadmap and a technical roadmap bring both and get one proposal. The proposal links each technical item to the product outcome it delivers, and a person checks every link before anything is saved.

**Build**

- Import page: a "Product and technical roadmap" mode with two inputs, each a paste box or a file that goes through `readRoadmapInput`. The current one-input import stays as it is.
- Line references, not a parser: before the prompt, each non-empty line of each input is prefixed with a reference (`P12`, `T14`). The model cites these references instead of retyping rows. Code checks that every cited reference exists, so the model cannot invent a row. This works for CSV, Markdown and text alike, and adds no dependency. Excel users save as CSV, as with the file import.
- Paired import agent (`src/agents/paired-import.ts`). Its output:
  - Outcomes come from the product roadmap, and requirements come from the technical roadmap.
  - Titles keep the team's own words, minus issue keys and ids (rule 5). The single-input import still writes titles in customer language, but here the team has already chosen its wording.
  - Each requirement names its outcome, a confidence (`high` or `low`), a one-line reason and the lines it came from.
  - Product items with no technical work become outcomes with no requirements, so the product view shows them as not started. That gap is itself useful to see.
  - Technical items that deliver no outcome are **not placed**. They are listed with a suggested outcome, or none.
- Existing status: technical rows marked in progress or done are imported with that status, so outcome progress is right from day one. `create_requirement` gains an optional `status` that defaults to `planned`. Rows marked won't do, cancelled or duplicate are still left out, and so are rows under a product item that has already shipped. The rationale names what was left out.
- Proposal storage: a nullable `import_mapping` JSON column on `proposals`, validated by Zod, holds each placed requirement's confidence, reason and lines, plus the unplaced items. It is review metadata, not a graph operation. Approving writes only the operations, as now.
- Mapping review on `/p/[slug]/review`, for proposals that have an `import_mapping`:
  - Requirements are grouped under their outcomes, with low-confidence links marked and the reason shown.
  - A select on each requirement moves it to another outcome in the proposal or the project. This is the one edit that changes a `create_requirement`'s `outcome_key`.
  - A "Needs a home" list shows each unplaced item. The reviewer places it under an outcome, which turns it into a `create_requirement` operation, or leaves it out.
  - Approve stays disabled until every unplaced item is placed or left out. The server refuses approval too, since the form cannot be trusted.
  - Every requirement still serves an outcome. There is no hidden "internal" outcome, and the data model is unchanged apart from `status` on create.
- Demo: a paired sample (an Acme Analytics product roadmap CSV and a technical roadmap CSV) with its own fixture output. The fixture has one low-confidence link, one outcome with no plan, one done requirement and two unplaced items: one with a suggested outcome, and one that is upkeep ("Upgrade Postgres") with none.
- Docs: `ARCHITECTURE.md` describes the paired import, `import_mapping`, `status` on `create_requirement` and the mapping review.

**Acceptance criteria**

- With no model key, the paired sample produces its fixture proposal end to end.
- A model answer that cites a line reference that does not exist fails validation and gets the usual single retry. It is never partially saved.
- Tests show approval is refused while any item is unplaced, and allowed once each is placed or left out.
- A test shows that moving a requirement to another outcome, or placing an unplaced item, produces operations that `applyProposal` accepts. The test also shows the approved graph matches what the reviewer chose.
- A test shows an imported `done` requirement counts toward its outcome's progress straight away, and writes an event like any other create (rule 4).
- A Playwright smoke test imports the paired sample, places one item, leaves the other out and approves.

---

## Stage 9: Linear issues as work items

Teams that plan in Throughline but assign and track work in Linear get the same tracking as GitHub. Linear issues become work items, and finishing one leads to reconciliation, just like a merged PR. Builds on the Linear client from the Linear roadmap import (#66).

**Build**

- Generalise `SourceAdapter` only as far as Linear needs. `source` becomes `"github" | "linear"`, and the connected container is a repository for GitHub and a team for Linear. Changed files stay GitHub-only. A Linear issue has none, so the agents use its title and description, as they already do without GitHub credentials.
- `LinearAdapter` in `src/adapters/linear/`, wrapping the existing GraphQL client:
  - **Id:** the issue's stable Linear id is the `externalId`.
  - **State:** `completed` becomes `closed`, `canceled` (and duplicate) becomes `not_planned`, and anything else is `open`.
  - **People:** the assignee, with bots left out.
  - **Updates:** `updatedAt` is used to ignore deliveries that arrive out of order.
- Connect a Linear team on `/p/[slug]/settings`. The backfill brings in open issues plus issues completed in the last 90 days, one page per job, like the GitHub backfill.
- `POST /api/linear/webhook`: verifies the `Linear-Signature` HMAC with `LINEAR_WEBHOOK_SECRET` (added to `.env.example`) and upserts issues through `syncWorkItem`.
- Links: explicit references (`TL-12`) in a Linear issue's title or description link it the same way a PR's references do. Unreferenced issues that complete go to the link suggestion agent.
- One piece of work, one reconciliation. Linear often attaches the PR that fixes an issue, so the issue and the PR can both reach the same requirement. Reconcile already skips leaves that are no longer planned or in progress, and a newer proposal supersedes an older pending one. The acceptance tests below show that this is enough, so no new de-duplication is built unless they fail.
- Throughline only reads from Linear. It never creates, assigns or changes Linear issues.
- Demo projects use `FakeLinearSource` and never call Linear (rule 7).
- Docs: `docs/LINEAR.md` gains webhook setup, and `ARCHITECTURE.md` describes the second source.

**Acceptance criteria**

- Webhooks with a bad signature are rejected with 401, and replaying the same webhook twice creates no duplicates.
- State mapping and reference parsing for Linear issues are unit tested.
- Completing a Linear issue that references a requirement queues a reconciliation job.
- A test shows that a Linear issue completing and its attached PR merging leave at most one pending reconcile proposal for the requirement.
- GitHub sync behaves exactly as before, shown by the existing tests passing unchanged.

---

## Future work

Designed for, not built in v1. Each has a `future` issue.

- **Feedback ingestion**: GitHub issues labelled `feedback` first, then support and CRM sources. Feedback is clustered and linked to outcomes so you can see customer pull per outcome, and unmatched feedback flags gaps. GitHub is built (see "Feedback" in `ARCHITECTURE.md`); support and CRM sources are still to come.
- **Research agent**: a scheduled agent that checks planned technical approaches against current libraries and best practice, and watches the product landscape. Findings appear as comments on graph nodes.
- **More sources**: a Jira `SourceAdapter`. Linear is Stage 9.
- **Re-import as a diff**: keep each imported row's own id, so importing an updated roadmap proposes changes to existing outcomes and requirements instead of duplicates.
- **Teams and permissions**: organisations, roles (viewer, PM, admin) and SSO.
- **Digests**: a weekly plain-language summary to Slack or email for non-technical stakeholders. Slack is built (see "Weekly digest" in `ARCHITECTURE.md`); email is still to come.
