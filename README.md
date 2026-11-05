# Throughline

Traces every PR back to a customer-facing outcome, even after a requirement has split into several pieces.

**Try it:** [run it locally](#run-it-locally) in a few minutes with no accounts or keys, or [deploy your own](docs/DEPLOY.md) public demo on Vercel. Either way, **Open demo** goes straight to a sample company's roadmap with no sign-in.

## What Throughline does

Product roadmaps and engineering work drift apart. A requirement turns out to need four pieces of work instead of one, something ships differently than planned, and soon nobody outside engineering can say what customers can actually use today.

Throughline keeps them connected:

- **One source of truth.** Product outcomes, the technical requirements that deliver them, and the GitHub issues and pull requests behind those requirements live in one linked graph. The product roadmap and the technical roadmap are two views of it.
- **Plan versus reality.** When a pull request merges, an AI agent compares what was built with what was planned and proposes an update: mark it done, split it, or record that the scope grew.
- **People stay in charge.** Nothing changes until a product manager approves the proposal.
- **Plain-language status.** Sales and leadership see what is delivered, what is partially available and why plans changed, without reading tickets.

The **product view** answers "what can customers use today?" in plain language:

![The product view: each customer outcome with a status, progress and what is available today](docs/images/product-view.png)

The **technical view** shows every requirement, how it was split, and the issues and pull requests behind it:

![The technical view: outcomes, requirements and their split children, with linked pull requests](docs/images/technical-view.png)

The **review queue** is where a person approves, edits or rejects what the agents propose:

![The review queue: a proposal to mark Excel export as done, with its reasoning and a diff](docs/images/review-queue.png)

## How it works

1. **Import a roadmap.** Paste a roadmap or planning notes. The import agent drafts product outcomes and technical requirements (`TL-1`, `TL-2`, …) as a proposal for review.
2. **Connect a repository.** A GitHub App sends Throughline every issue and pull request change. A pull request that says `Implements TL-12` or `Part of TL-12` is linked to that requirement, and opening it marks the requirement in progress.
3. **Reconcile when work ships.** When linked work merges, the reconciliation agent reads the pull request and the plan and proposes what changed: done, partly done, split into new pieces, or scope added. A merged pull request with no reference gets a suggested link instead.
4. **Approve.** Every proposal waits in the review queue. Approving it changes the graph and writes an event with a plain-language note, which feeds the product view's "what changed this week".
5. **Read the roadmaps.** Status rolls up from finished work to requirements to outcomes, so both views always agree.
6. **Hear from customers.** An issue labelled `feedback` is customer feedback, not work. The feedback agent names what it asks for and proposes the outcome that would deliver it, so the feedback page shows how much each outcome is asked for, and feedback no outcome covers, grouped by theme, shows what the roadmap is missing.
7. **Send a weekly digest.** Every Monday a plain-language summary of what changed and where each outcome stands can go to a Slack channel, for people who never open Throughline. Set it up on a project's settings page.

The full design, data model and trade-offs are in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Why not just use Linear or Jira?

Linear and Jira are trackers. People create tickets, people move them, and the plan is whatever the tickets say. Both can roll a status up to an epic or a project, but they roll up a field a person set. When engineering ships something different from what the epic describes, the epic stays wrong until someone notices, and nobody outside engineering can tell. That drift is the problem, and a tracker cannot fix it because it has no source of truth apart from its own tickets.

Throughline turns the direction of truth around. The code is the record of what shipped. An agent reads the merged pull request, compares it with the plan, and proposes how the plan should change. A person's job shrinks from maintaining the plan to approving changes to it. Four things follow from that:

- **Splits are first-class and keep their history.** When one requirement turns out to be four, the original survives with the reason it was split and a plain-language note, so the product view can say why a date moved. In a tracker that becomes four new tickets and a stale parent.
- **"Partially available" is a real status.** It is computed from which finished pieces customers can actually use. It is the honest answer to the sales question "can customers use any of this yet?", and no tracker has it.
- **The changelog is written for non-engineers as a side effect of engineering.** Every approved change carries a product note, and the "what changed this week" feed is built from those notes. A tracker's history is field changes per ticket.
- **The write model is built for agents.** Every change is a typed operation, every operation is an event, and every agent output is a proposal. Adding an agent that reads customer feedback or checks planned approaches against current libraries is a new proposal source, not a new subsystem.

Throughline is not a tracker and should not grow into one. It has no sprints, assignees or estimates. It is a layer above the tracker and the repository that answers one question trustworthily: what have we promised, and what has actually shipped?

## Who it is for

**A small team**, a few engineers and a founder acting as product manager. The roadmap document goes stale two weeks after it is written, and the founder cannot tell investors or customers what has shipped. Throughline's offer is a roadmap that maintains itself for a few minutes of review a week: paste the roadmap, connect the repository, reference requirement keys in pull requests, approve proposals. The product view doubles as the changelog and the investor update. For a team whose tracker is GitHub Issues, Throughline can be the whole roadmap layer.

**A large organisation**, many teams, many product managers, a sales enablement function. Here the drift is organisational. Leadership keeps a roadmap in slides, each team keeps its own board, sales was told a quarter and the feature shipped two quarters later at half scope. "Is this available for that customer?" is a chat question answered from memory. Reconciling the plan from the diff scales where human discipline does not: nobody updates the epic, but the diff is always there. Splits with lineage handle outcomes that fracture across teams, and the event log gives an auditable answer to "when did this slip and why", captured at the moment of the pull request rather than reconstructed in a retrospective. To get there, Throughline needs Linear and Jira adapters, organisations and ownership routing so each proposal reaches the right product manager, and tiered approval so high-confidence results can be batch-approved while splits and scope changes still get a person. Those are listed under [Future work](#future-work).

**The wider bet.** As more code is written by agents, "who updated the ticket?" gets worse, because the author of the code never had a ticket. Reconciling the plan from what was actually built is the approach that still works when the author is a machine. If that holds, a tracker's status field becomes derived data, and the thing organisations need, a trustworthy map from customer promises to shipped code, becomes the primary artifact.

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

Open http://localhost:3000 and click **Open demo**. Data is stored in an embedded Postgres (PGlite) under `./.pglite`. To use a Postgres server such as Neon instead, copy `.env.example` to `.env.local` and set `DATABASE_URL`.

What to try:

- **Product view** (`/p/acme-analytics`): what customers can use today and what changed this week. **Show technical detail** adds requirement keys.
- **Technical view** (`/p/acme-analytics/tech`): the requirement tree, linked work and split history.
- **Plan** (`/p/acme-analytics/plan`): drag outcomes into a new priority order and change targets in place; each move shows up in the product view's change feed. Work due after its outcome's target is flagged.
- **Review queue** (`/p/acme-analytics/review`): approve, edit or reject the pending proposals, then watch the product view change.
- **Import** (`/p/acme-analytics/import`): paste a roadmap. Without a model key you get a sample proposal; set `ANTHROPIC_API_KEY` in `.env.local` to use Claude, or `OPENROUTER_API_KEY` to use a free model through OpenRouter.
- **Settings** (`/p/acme-analytics/settings`): connect a real repository once you have set up a GitHub App as described in [`docs/GITHUB_APP.md`](docs/GITHUB_APP.md).

Checks that CI runs on every pull request:

```bash
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test
pnpm exec playwright install chromium   # once
pnpm test:e2e                           # builds the app and loads the demo
```

## Design decisions

- **The AI proposes; people decide.** Every model output becomes a proposal, and only an approved proposal changes the graph. A misread pull request costs a click to reject, not a wrong roadmap.
- **Splits keep the parent link.** Splitting a requirement adds children under it, so a customer outcome never loses track of the work that delivers it.
- **Parent status is computed, never stored.** Only leaf requirements have a status; everything above is a pure function of them, so there is no rollup state to drift.
- **Every change is an event**, with who made it and a plain-language note. The "what changed" feed is just this log.
- **Integrations sit behind adapters.** GitHub is one `SourceAdapter`. Claude and OpenRouter are two `LLMProvider`s, so Linear, Jira or another model can be added without touching the core.
- **Everything works without secrets.** With no model key or GitHub App, the app uses a fake model and demo data. Tests never call real services.
- **A public site without sign-in stays safe.** With `PUBLIC_DEPLOYMENT=true`, visitors can change only the demo: its agents run on a free OpenRouter model or on sample results and never on the Anthropic key, proposals can be approved or rejected but not edited, and it resets nightly. Every other project is view-only. The whole site fits the free tiers of Vercel, Neon and OpenRouter; see [`docs/DEPLOY.md`](docs/DEPLOY.md#running-it-for-free).

## Throughline on Throughline

Throughline is built to track its own build: its seven-stage plan, [`docs/PLAN.md`](docs/PLAN.md), is imported into a `throughline` project on the public site, and this repository is connected to it, so each stage's pull request updates that roadmap when it merges. The setup steps are in [`docs/DEPLOY.md`](docs/DEPLOY.md#dogfooding-throughline-tracking-its-own-roadmap).

## Built with Claude

Throughline was built with [Claude Code](https://claude.com/claude-code), one stage of [`docs/PLAN.md`](docs/PLAN.md) per pull request. [`CLAUDE.md`](CLAUDE.md) gives every session the design rules and conventions above, and each pull request was reviewed before it merged. Inside the app, the import, reconciliation, link suggestion and feedback agents call Claude through the Anthropic TypeScript SDK, or any OpenRouter model through a second provider that the public demo uses with a free model.

## Future work

Designed for but not built in v1; each has an issue:

- [Feedback ingestion](../../issues/8): GitHub issues labelled `feedback` are built; support and CRM sources are still to come.
- [Research agent](../../issues/9): check planned approaches against current libraries and the market.
- [More sources](../../issues/10): Linear and Jira alongside GitHub.
- [Teams and permissions](../../issues/11): organisations, roles and SSO, replacing the public site's view-only rule.
- [Work breakdown](../../issues/23): group technical work by type, team and person.

## Learn more

- [Architecture and data model](docs/ARCHITECTURE.md)
- [Build plan](docs/PLAN.md)
- [Deploying to Vercel and Neon](docs/DEPLOY.md)
- [GitHub App setup](docs/GITHUB_APP.md)

## License

MIT. See [LICENSE](LICENSE).
