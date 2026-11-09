# Throughline

Product and technical roadmaps that stay true to what ships.

Throughline links every product outcome to the technical requirements that deliver it, and every requirement to the GitHub pull requests and Linear issues behind it. When work merges, an AI agent compares the plan with what was built and proposes the roadmap update. A person approves it. The product view then says, in plain language, what customers can use today and what changed this week.

https://github.com/user-attachments/assets/c134a7a7-c978-4fda-9ba3-6519e8923006

**Try it:** the [public demo](https://throughline-roadmap.vercel.app) needs no sign-in, or [run it locally](#run-it-locally) in a few minutes with no accounts or keys.

## What it does

- **One graph, two views.** Outcomes, requirements and the work behind them live in one linked graph. The product view is for sales and leadership; the technical view shows every requirement, how it was split, the linked issues and pull requests, and progress by team.
- **Plan versus reality.** When linked work merges, the reconciliation agent reads the pull request and the plan and proposes what changed: done, partly done, split into new pieces, or scope added. A merged pull request with no reference gets a suggested link.
- **People decide.** Every agent output is a proposal in the review queue. Approve, edit or reject it; nothing changes until it is approved, and every approval writes an event with a plain-language note.
- **Import from where you plan.** Paste notes, upload the CSV, Markdown or HTML export of Jira, Productboard, Aha!, Notion or Confluence, read a team's initiatives and projects straight from Linear, or import a product roadmap and a technical roadmap together, linked to each other.
- **Replan and listen.** Drag outcomes into priority order and change targets on the plan page. A slip check proposes a later target when work is due after its outcome's target. Issues labelled `feedback` land on the feedback page, matched to the outcome that would deliver them, and a weekly Slack digest sums up the week for people who never open Throughline.

## How it works

1. **Import a roadmap.** The import agent drafts product outcomes and technical requirements (`TL-1`, `TL-2`, …) as a proposal.
2. **Connect a repository or a Linear team.** A pull request or issue that says `Implements TL-12` or `Part of TL-12` is linked to that requirement, and starting it marks the requirement in progress.
3. **Reconcile when work ships.** Merged work becomes a proposal: done, partly done, split or scope added.
4. **Approve.** The review queue is the only way into the graph. Approving writes an event with a plain-language note, which feeds the product view's "what changed this week" and the weekly digest.
5. **Read the roadmaps.** Status rolls up from finished work to requirements to outcomes, so both views always agree.

The full design, data model and trade-offs are in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Run it locally

You need Node.js 22 and pnpm (`corepack enable pnpm`). No accounts or API keys are needed.

```bash
git clone https://github.com/JakobKrzyston/throughline-roadmap.git
cd throughline-roadmap
pnpm install
pnpm db:migrate   # create the tables
pnpm db:seed      # load the "Acme Analytics" demo project
pnpm dev
```

Open http://localhost:3000 and click **Open demo**. Data is stored in an embedded Postgres (PGlite) under `./.pglite`; to use a Postgres server such as Neon instead, copy `.env.example` to `.env.local` and set `DATABASE_URL`.

What to try in the demo:

- **Product view** (`/p/acme-analytics`): outcomes by status and target quarter, what customers can use today, and what changed this week.
- **Technical view** (`/tech`): the requirement tree with linked work, split history and progress by team. Filter by kind of work, team and person.
- **Review queue** (`/review`): five pending proposals, one of each kind. Approve, edit or reject one and follow the link to where the change shows.
- **Plan** (`/plan`): reorder outcomes, change targets, and set each requirement's target, kind of work and team.
- **Feedback** (`/feedback`): requests no outcome covers, grouped by theme, then how much each outcome is asked for.
- **Import** (`/import`): paste a roadmap, upload an export, load a sample Jira, Productboard or Notion export, import a product and a technical roadmap together, or import from a sample Linear workspace.
- **Settings** (`/settings`): read the next weekly digest, connect the sample Linear team `ENG`, and connect a real repository once a GitHub App is set up.

Without a model key the agents return sample results; set `ANTHROPIC_API_KEY` or `OPENROUTER_API_KEY` in `.env.local` to use a real model. Real GitHub and Linear connections are described in [`docs/GITHUB_APP.md`](docs/GITHUB_APP.md) and [`docs/LINEAR.md`](docs/LINEAR.md). Every page works on a phone and follows your system's light or dark theme.

Checks that CI runs on every pull request:

```bash
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test
pnpm exec playwright install chromium   # once
pnpm test:e2e                           # builds the app and loads the demo into its own database
```

To deploy your own public demo on Vercel and Neon, follow [`docs/DEPLOY.md`](docs/DEPLOY.md). A production build fails, naming the missing files, if the database is behind on migrations; it never migrates on its own.

## Design decisions

- **The AI proposes; people decide.** Every model output becomes a proposal, and only an approved proposal changes the graph. A misread pull request costs a click to reject, not a wrong roadmap.
- **Splits keep the parent link.** Splitting a requirement adds children under it, so a customer outcome never loses track of the work that delivers it.
- **Parent status is computed, never stored.** Only leaf requirements have a status; everything above is a pure function of them, so there is no rollup state to drift.
- **Every change is an event**, with who made it and a plain-language note. The "what changed" feed is just this log.
- **Integrations sit behind adapters.** GitHub and Linear are `SourceAdapter`s; Claude and OpenRouter are `LLMProvider`s. Jira or another model is a new adapter, not a change to the core.
- **Everything works without secrets.** With no model key, GitHub App or Linear key, the app uses a fake model, demo data and a sample Linear workspace. Tests never call real services.
- **A public site without sign-in stays safe.** With `PUBLIC_DEPLOYMENT=true`, visitors can change only the demo, its agents never run on the Anthropic key, and it resets nightly. Every other project is view-only. The whole site fits the free tiers of Vercel, Neon and OpenRouter.

Throughline is not a tracker and should not grow into one. It has no sprints, assignees or estimates. It is a layer above the tracker and the repository that answers one question: what have we promised, and what has actually shipped?

## Who it is for

A **small team** gets a roadmap that maintains itself for a few minutes of review a week, and a product view that doubles as the changelog and the investor update. A **large organisation** gets the drift between leadership's slides, each team's board and what sales was told reconciled from the diff, which scales where human discipline does not, with an auditable answer to "when did this slip and why". And as more code is written by agents, "who updated the ticket?" gets worse, because the author of the code never had a ticket; reconciling the plan from what was actually built still works when the author is a machine.

## Throughline on Throughline

Throughline tracks its own build: [`docs/PLAN.md`](docs/PLAN.md) is imported into a `throughline` project on the public site, and this repository is connected to it, so each stage's pull request updates that roadmap when it merges. The setup steps are in [`docs/DEPLOY.md`](docs/DEPLOY.md#dogfooding-throughline-tracking-its-own-roadmap).

## Built with Claude

Throughline was built with [Claude Code](https://claude.com/claude-code), one stage of [`docs/PLAN.md`](docs/PLAN.md) per pull request and then issue by issue. [`CLAUDE.md`](CLAUDE.md) gives every session the design rules above, and each pull request was reviewed before it merged. Inside the app, the agents call Claude through the Anthropic TypeScript SDK, or any OpenRouter model through a second provider that the public demo uses with a free model.

## Future work

Designed for but not built yet; each has an issue:

- [Research agent](../../issues/9): check planned approaches against current libraries and the market.
- [More sources](../../issues/10): Jira alongside GitHub and Linear.
- [Teams and permissions](../../issues/11): organisations, roles and SSO, replacing the public site's view-only rule.
- [MCP server](../../issues/71): let coding agents read and update the roadmap from where they work.

Two built features have a second half still to come: feedback from support and CRM tools (GitHub issues labelled `feedback` work today), and the weekly digest by email (Slack works today).

## Learn more

- [Architecture and data model](docs/ARCHITECTURE.md)
- [Build plan](docs/PLAN.md)
- [Deploying to Vercel and Neon](docs/DEPLOY.md)
- [GitHub App setup](docs/GITHUB_APP.md)
- [Linear setup](docs/LINEAR.md)

## License

MIT. See [LICENSE](LICENSE).
