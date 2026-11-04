# Throughline architecture

Throughline keeps a product roadmap and a technical roadmap in sync with what engineering actually ships. This document explains how it is put together and why.

## The one idea everything depends on

Both roadmaps are **views of a single traceability graph**, not separate documents.

```
Product outcome  ──►  Technical requirement  ──►  Work item
"Customers can        "Async export job           GitHub issue / PR
 export to Excel"      service"                    (#41, #44, #47)
                          │
                          ├─ child: "Job queue"
                          ├─ child: "Storage migration"
                          └─ child: "Export UI"
```

- A **product outcome** is something a customer or buyer would recognise. It is written in plain language.
- A **technical requirement** is what engineering must build to deliver an outcome. Requirements can be **split** into child requirements as engineering learns more.
- A **work item** is a GitHub issue or pull request. Work items are linked to the requirement they implement.

Status flows **up** the graph. Plans flow **down**. Because both roadmaps read from the same graph, they cannot drift apart.

## Design rules

These rules are deliberate. They are also listed in `CLAUDE.md` so every coding session respects them.

1. **The AI proposes; people decide.** Every LLM output (an imported roadmap, a reconciliation result, a suggested link) becomes a `Proposal`. Only an approved proposal changes the graph. This keeps the roadmap trustworthy even when the model misreads a PR.
2. **Splits keep the parent link.** Splitting a requirement creates children under it. The original requirement is never replaced, so its link to the product outcome survives.
3. **Parent status is computed, never stored.** Only leaf requirements carry a status. Parent requirements and outcomes derive their progress from their leaves on read. There is no rollup state to fall out of sync.
4. **Everything is an event.** Every change to the graph is written to an append-only `events` table with who made it, why, and a plain-language note. The product view's "what changed" feed is built from this log.
5. **Plain language first.** The product view never shows ticket numbers, branch names or jargon unless the reader expands a detail panel.
6. **Integrations sit behind adapters.** GitHub is one `SourceAdapter`. Anthropic is one `LLMProvider`. Linear, Jira or another model provider can be added without touching the core.

## System overview

```
 Inputs                     Core                               Outputs
 ──────                     ────                               ───────
 Roadmap import  ──┐
 (paste text/MD)   │     ┌──────────────────────────┐
                   ├───► │  Traceability graph      │ ───► Product view
 GitHub App      ──┤     │  outcomes, requirements, │      (sales, leadership)
 (issues, PRs,     │     │  work items, links       │
  webhooks)        │     └────────────▲─────────────┘ ───► Technical view
                   │                  │ approved              (engineering)
                   │     ┌────────────┴─────────────┐
                   └───► │  Agents → Proposals      │ ───► Review queue
                         │  import, reconcile, link │      (PM approves)
                         └──────────────────────────┘
```

## Stack

| Layer           | Choice                                 | Why                                                                |
| --------------- | -------------------------------------- | ------------------------------------------------------------------ |
| App             | Next.js (App Router) + TypeScript      | One language front to back; easy deploy with a live demo link      |
| UI              | Tailwind CSS + shadcn/ui               | Accessible, clean defaults for a non-technical audience            |
| Database        | Postgres via Drizzle ORM               | Plain relational tables handle the graph; no graph database needed |
| Local / test DB | PGlite (embedded Postgres)             | Same SQL dialect as production with zero setup                     |
| Production DB   | Neon (serverless Postgres)             | Free tier, works well with Vercel                                  |
| GitHub          | GitHub App + Octokit                   | One integration handles auth, repo access and webhooks             |
| LLM             | Anthropic SDK behind `LLMProvider`     | Tool use with JSON schemas for structured output                   |
| Tests           | Vitest (+ Playwright for a smoke test) | Fast unit tests for rollup and agent logic                         |
| CI              | GitHub Actions                         | Lint, typecheck, test on every PR                                  |
| Hosting         | Vercel                                 | Preview deploys per PR; public demo URL                            |

## Data model

All IDs are UUIDs except where noted. Timestamps are omitted for brevity; every table has `created_at` and `updated_at`.

### `projects`

One roadmap workspace. Fields: `id`, `name`, `slug`, `is_demo`.

### `repositories`

Source repositories connected to a project. Fields: `project_id`, `source` (`github`), `external_id` (GitHub's numeric repository id, which survives renames), `full_name` (`owner/name`, refreshed from each webhook so it follows renames). Webhooks find their project through `(source, external_id)`; one repository may be connected to several projects.

### `outcomes`

Product-facing goals.

| Field         | Notes                                    |
| ------------- | ---------------------------------------- |
| `id`          |                                          |
| `project_id`  |                                          |
| `key`         | Human-readable key, e.g. `OUT-3`         |
| `title`       | Plain language, customer-facing          |
| `description` | Plain language                           |
| `target`      | Optional quarter or date, e.g. `2027-Q1` |
| `priority`    | Integer, lower is higher priority        |
| `archived`    | Soft delete                              |

### `requirements`

Technical work, arranged as a tree under each outcome.

| Field                  | Notes                                                                             |
| ---------------------- | --------------------------------------------------------------------------------- |
| `id`                   |                                                                                   |
| `project_id`           |                                                                                   |
| `key`                  | e.g. `TL-12`. This is what PRs reference.                                         |
| `outcome_id`           | Set on root requirements only                                                     |
| `parent_id`            | Set on child requirements only. Exactly one of `outcome_id` / `parent_id` is set. |
| `title`, `description` | Technical language is fine here                                                   |
| `status`               | Leaf only: `planned`, `in_progress`, `done`, `dropped`. Null on parents.          |
| `user_visible`         | True if finishing this gives customers something they can see or use              |
| `product_note`         | Plain-language explanation shown in the product view                              |
| `split_reason`         | Why this requirement was split, if it was                                         |
| `target`               | Optional quarter or date, compared with the outcome's target (see "Schedule")     |

### `work_items`

Mirrors of GitHub issues and pull requests.

| Field                    | Notes                                                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `id`                     |                                                                                                                  |
| `project_id`             |                                                                                                                  |
| `source`                 | `github` (later `linear`, `jira`)                                                                                |
| `external_id`            | e.g. `1043219876#41`: repository id, then number                                                                 |
| `kind`                   | `issue` or `pull_request`                                                                                        |
| `title`, `url`, `state`  | `state`: `open`, `closed`, `merged`, `not_planned` (an issue closed as not planned or duplicate)                 |
| `body_excerpt`           | First part of the description, for agent context                                                                 |
| `merged_at`, `closed_at` |                                                                                                                  |
| `source_updated_at`      | When GitHub last changed the item. A delivery older than this is ignored, since webhooks can arrive out of order |

### `links`

Many-to-many between requirements and work items. Fields: `requirement_id`, `work_item_id`, `relation` (`implements` or `part_of`), `confidence` (`explicit` from a PR reference, or `suggested` from the agent and approved). The pair `(requirement_id, work_item_id)` is the primary key; links have no id of their own.

### `proposals`

The review queue.

| Field                      | Notes                                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------- |
| `id`                       |                                                                                                |
| `project_id`               |                                                                                                |
| `source`                   | `import`, `reconcile`, `link_suggest`, `explicit_link`, `work_started`, `manual`, `reschedule` |
| `status`                   | `pending`, `approved`, `rejected`, `superseded`                                                |
| `summary`                  | One plain-language line for the queue                                                          |
| `rationale`                | Why the agent suggests this                                                                    |
| `operations`               | JSON array of typed graph operations (see below)                                               |
| `trigger_work_item_id`     | The PR or issue that caused it, if any                                                         |
| `requirement_id`           | The requirement a `reconcile` proposal is about                                                |
| `decided_by`, `decided_at` |                                                                                                |

### `events`

Append-only audit log. Fields: `id`, `seq`, `project_id`, `type`, `entity_type`, `entity_id`, `actor` (user id or `agent`), `proposal_id`, `payload` (JSON), `product_note`.

`seq` is an identity column that records insertion order. Every event from one approved proposal shares `created_at`, so anything that needs "latest" or "newest first" orders by `seq`.

`type` is the operation type and `payload` is the operation itself. `entity_type` is `outcome` or `requirement`; link and unlink events belong to the requirement.

### `jobs`

A minimal job queue for agent runs. Fields: `id`, `type`, `payload`, `status` (`queued`, `running`, `done`, `failed`), `attempts`, `last_error`, `run_after`.

Job types are `backfill` (`{ repositoryId, mergedSince?, cursor? }`), `reconcile` (`{ workItemId, requirementId }`), `link_suggest` (`{ workItemId }`) and `slip_check` (`{ outcomeId }`). `enqueue()`, `enqueueReconcile()`, `enqueueSlipCheck()` and `runJobs()` live in `src/jobs/queue.ts`. `enqueueSlipCheck` adds nothing when a check for the same outcome is already queued, since the check reads the outcome as it is when it runs. `enqueueReconcile` folds a reconciliation into a `queued` job for the same requirement instead of adding another, pointing that job at the newest work item: the agent judges the requirement as a whole and sees every work item linked to it, so when several pull requests merge before the first job runs, one run covers them all. A job that is already `running` is left alone, and the new job's proposal supersedes its proposal. A runner claims one job at a time with `FOR UPDATE SKIP LOCKED`, so concurrent runners never share a job. A failed job is retried after a delay, up to three attempts, then marked `failed`. A job left `running` for 15 minutes (for example, cut off by a serverless timeout) is claimed again. Job types without a handler stay `queued`. A handler may return the payload of a follow-up job of the same type; it is queued in the same transaction that marks the job done, so a job cut off before that point never queues its follow-up twice.

## Graph operations

Proposals carry a list of typed operations. Applying a proposal runs them in one transaction and writes one event per operation. Operations are validated with Zod before they reach the database.

| Operation            | Effect                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `create_outcome`     | Add a product outcome                                                                    |
| `update_outcome`     | Change title, description, target or priority; see below for its event's note            |
| `create_requirement` | Add a root requirement under an outcome, optionally with a target                        |
| `split_requirement`  | Turn a leaf into a parent with N new children; records `split_reason` and a product note |
| `update_requirement` | Change title, description, `user_visible`, product note or target                        |
| `set_status`         | Set a leaf's status                                                                      |
| `link_work_item`     | Link a work item to a requirement                                                        |
| `unlink_work_item`   | Remove a link                                                                            |

Operations name outcomes and requirements by `key` (`OUT-3`, `TL-12`), not by id, so one proposal can create an outcome and then add requirements under it. Work items are referenced by id because proposals never create them. Only leaves can be split or given a status. Each operation's optional `product_note` becomes the event's product note (and, for requirement create/update, the requirement's own note). Outcomes have no note of their own. When an `update_outcome` changes the target, `applyProposal` writes the move ("Moved from Q1 2027 to Q2 2027.", from `describeTargetMove`) from the target the outcome has at that moment, followed by the operation's note as the reason. A proposal made against an older plan, or edited by a reviewer, therefore cannot put a move that did not happen in the change feed.

`applyProposal(db, proposalId, actor)` in `src/core/proposals.ts` is the only code that changes the graph. It locks the proposal, validates its operations with Zod, applies them in order in one transaction, writes one event per operation and marks the proposal `approved`. If any operation fails, nothing changes. `rejectProposal` marks a proposal `rejected` and touches nothing else.

Because a proposal is just data, the review UI can show it as a readable diff (`describeOperations` in `src/core/proposal-diff.ts`) and the PM can edit it before approving. `applyProposal` accepts the edited operations in place of the stored ones and saves them on the proposal. An edit may change wording and values (titles, notes, statuses, whether customers can see it) but not what the proposal touches: the same operations, in the same order, on the same keys and work items. Anything else is refused.

## Rollup rules

Computed on read by pure functions in `src/core/rollup.ts`.

- A leaf's progress is `1` if `done`, `0` otherwise. `dropped` leaves are excluded.
- A parent's progress is the share of its non-dropped leaf descendants that are done. Every leaf counts equally in v1. Weighting is a future option.
- An outcome's progress is the same calculation over all its requirements.
- An outcome's **product status** is:
  - `not_started`: no leaf is `in_progress` or `done`
  - `in_progress`: some work started, nothing user-visible done
  - `partially_available`: at least one `user_visible` leaf is done, but not all leaves
  - `delivered`: every non-dropped leaf is done
- `partially_available` matters most for sales. It is the honest answer to "can customers use any of this yet?"

## Linking PRs to requirements

1. **Explicit:** a PR body or title containing `Implements TL-12` or `Part of TL-12` creates a link automatically. This is deterministic and needs no review. Matching is case-insensitive, one phrase can list several keys (`Part of TL-3, TL-4 and TL-5`), and keys that are not in the project are ignored (`src/core/references.ts`). The links still go through a proposal with source `explicit_link`, approved at once by the `github-sync` actor, so `applyProposal` stays the only code that changes the graph and every link has an event. Removing a reference from a PR later does not remove the link.
2. **Suggested:** if a merged PR has no reference, the link agent compares it to the project's requirements and proposes the best match. A person approves it.
3. **Work started:** an open PR that is linked to a `planned` leaf moves it to `in_progress`, through a `work_started` proposal approved at once by `github-sync`, like an explicit link. Requirements that are already started, finished, dropped or split are left alone, issues never start work, and closing a PR without merging does not move the requirement back. This is what makes an outcome show "in progress" before anything has shipped.

## Agents

All agents call `LLMProvider.generateStructured(schema, prompt)` (`src/adapters/llm/`), which returns output that matches a Zod schema.

- `AnthropicProvider` offers Claude a single tool whose input schema is generated from the Zod schema, and reads the answer from the tool call. Current Claude models reject forced `tool_choice`, so the system prompt asks for the call and a reply without one counts as invalid output. The model comes from `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`).
- Output that fails Zod validation is retried **once**: the validation error goes back to the model as a failed tool result. If the second attempt also fails, the provider raises `LLMOutputError`, whose message is shown to the user. Agents write nothing until they have valid output, so a failed run never leaves a partial proposal.
- `OpenRouterProvider` (`src/adapters/llm/openrouter.ts`) does the same against OpenRouter's OpenAI-compatible API with plain `fetch`, so any model there works, including free ones. It asks for a tool call but also accepts JSON in the reply text, since free models do not all honour `tool_choice`. `OPENROUTER_MODEL` is a comma-separated list in fallback order, sent as OpenRouter's `models` parameter so OpenRouter itself moves to the next model when one is rate-limited or down (default: free models with tool calling).
- `FakeLLMProvider` serves fixtures per task name with the same validation and retry. Tests use it, and so does the app when no model key is set (demo mode), so nothing needs an API key.
- `getLLMProvider` (`src/adapters/llm/index.ts`) picks Anthropic when `ANTHROPIC_API_KEY` is set, else OpenRouter when `OPENROUTER_API_KEY` is set, else the fake. `getDemoLLMProvider` is for demo projects, whose agents visitors can trigger: OpenRouter when its key is set, wrapped in `FallbackLLMProvider` so sample results take over when the model is rate-limited or answers badly, and never the Anthropic key.

### Roadmap import agent

Input: pasted text or Markdown (a roadmap, meeting notes, a product brief) from `/p/[slug]/import`. Output: one pending proposal with `create_outcome` and `create_requirement` operations. The prompt asks for customer-facing outcome titles and engineering-facing requirement titles, and marks which requirements are user-visible. Each outcome is one result customers would recognise and could be told about on its own: work that delivers the same result is grouped, separate capabilities stay apart even when they share a phase or theme, and the roadmap's layout does not decide the grouping. Internal engineering work (security, refactoring, tooling) goes under the outcome it supports rather than becoming an outcome. Targets must be a quarter (`2027-Q1`) or a date (`2027-01-11`); any other format counts as invalid output.

The model does not choose keys. `src/agents/import.ts` numbers new outcomes and requirements after the highest `OUT-n` and `TL-n` already in the project or claimed by a pending proposal, so an import cannot clash with existing work.

### Reconciliation agent

`src/agents/reconcile.ts`. Runs as a `reconcile` job when a linked PR merges or a linked issue closes, once per linked requirement. It only reconciles leaf requirements that are `planned` or `in_progress`; a requirement that has since been split, finished or dropped is skipped.

The context builder (`src/agents/context.ts`) gathers:

- the requirement, the requirements it was split from, and its outcome
- sibling requirements and their statuses, and the other work items linked to the requirement with the first 500 characters of their descriptions, so work covered elsewhere is not reported as missing and earlier finished work still counts
- the work item's title, state and description excerpt
- for a PR, its changed files from the `SourceAdapter`: totals, a list of up to 100 files with line counts, and as much diff as fits in 20,000 characters, at most 4,000 per file. Lockfile diffs are left out. Without GitHub credentials the agent works from the title and description alone.

Repository text goes inside tags the prompt tells the model to treat as data. The model classifies the result as one of:

- `fully_done`: propose `set_status(done)`
- `partially_done`: propose a split into the part that shipped (`done`) and the part that remains (`planned`)
- `done_differently`: propose `update_requirement` describing what was actually built, then `set_status(done)`
- `scope_grew`: propose a split into the newly discovered pieces (`planned`), plus the part that shipped (`done`) if any

Zod checks that the answer is consistent (a split for the two split classifications, at least one piece still to do, and so on), so an inconsistent answer gets the usual single retry. As with the import, the agent numbers new pieces itself after the highest `TL-n` in use.

Every proposal it makes includes a product note in plain language, for example: "Export took longer because it needed new background-job infrastructure, which also unblocks scheduled reports."

The proposal records its `requirement_id`. Saving it marks any older pending `reconcile` proposal for the same requirement `superseded` (decided by `agent`): the newer one was made with more of the work in view, since it sees every work item linked so far, and the prompt asks for a verdict on the requirement as a whole.

### Slip check

`src/agents/slip.ts`. Approving a `reconcile` proposal changes what is left to do under an outcome, so `approveProposal` queues a `slip_check` job for that outcome. The check first looks for a warning sign without the model (`loadSlipContext`): an unfinished requirement whose target is after the outcome's (`lateRequirements` in `src/core/schedule.ts`), or an outcome target that has passed while work is still open. An outcome with no target, no open work or no warning sign is left alone and the model is not called.

Otherwise the model sees the outcome, today's date, every requirement under it with its status, target and split reason, and the warning signs. It answers with a new target, or null when the late work is not needed for customers to get the outcome. Zod checks that a new target is a quarter or a date, later than the current one, no earlier than the latest late requirement, and not already past, so an impossible answer gets the usual single retry. A new target becomes a pending `reschedule` proposal with one `update_outcome` operation. The agent writes only the reason ("Handling bounced emails turned out to be its own piece of work."); the move itself is added to the note when the proposal is applied (see "Graph operations"). Every run supersedes the older pending `reschedule` proposals for the outcome, whatever it concludes: a new proposal was made with more in view, and when there is no warning sign any more, or the model keeps the target, an old one would slip an outcome that is on track. A run whose model output is invalid changes nothing.

Trade-off: the check runs when reconciled work changes the plan, not when time passes. An outcome whose target passes with no merges is flagged the next time its work is reconciled. A daily check would cover that once there is a cron that runs often enough.

### Link suggestion agent

`src/agents/link-suggest.ts`. Runs as a `link_suggest` job when a PR merges with no link at all (not during a backfill). The model sees the PR's title, description and changed files, and the leaf requirements that are not dropped, with their outcomes. Finished requirements stay in, since a fix to finished work belongs with it. A project with more than `MAX_CANDIDATES` (40) leaves is narrowed first by `rankCandidates`: requirements are scored by how many of their words appear in the PR's title, description and changed files, ties go to unfinished work, and the prompt says how many were left out so the model knows to answer null when the right one is missing. This keeps the prompt bounded on large roadmaps; a retrieval index is the next step if word overlap proves too crude. The answer must be one of those keys, or null when nothing fits well. A match becomes a pending `link_suggest` proposal with a `suggested` link; no match proposes nothing. A PR that has been linked since, or already has a pending suggestion, is skipped. If the PR later gains an explicit reference, the sync marks its pending suggestion `superseded`.

## GitHub integration

- A **GitHub App** with read access to issues, pull requests, contents and metadata, subscribed to `issues` and `pull_request` events. Setup steps are in `docs/GITHUB_APP.md`.
- `SourceAdapter` (`src/adapters/source.ts`) is the interface a source implements: look up a repository, list the items to backfill a page at a time, and list a PR's changed files for the agents. `GitHubAdapter` (`src/adapters/github/`) implements it with Octokit, authenticated as the app installation on each repository. Webhook signature checks and payload parsing also live there, and both webhook payloads and REST responses are validated with the same Zod schemas.
- Repositories are connected on `/p/[slug]/settings`. Connecting checks that the repository's owner is in `GITHUB_ALLOWED_OWNERS` (v1 has no sign-in, so this stands in for permissions until #11) and that the app is installed on it, stores it, and enqueues a **backfill**: open issues plus PRs merged in the last 90 days. The backfill links explicit references but queues no reconciliation, since that work finished before Throughline was watching. It runs one page (up to 100 items) per job: each job syncs its page and returns the next page's job, carrying the source's cursor and the cut-off date the first page chose. A run therefore does a bounded amount of work, and a retry repeats only the page that failed. The settings page shows each repository's import as in progress, retrying (with the error), or failed (with the error), from its newest backfill job.
- `POST /api/github/webhook` verifies the `X-Hub-Signature-256` header against the raw body (401 if it does not match), then hands the work item to `syncWorkItem` (`src/core/work-items.ts`) for every project the repository is connected to.
- `syncWorkItem` upserts the work item, creates explicit links, starts work on the planned requirements an open PR is linked to, and queues a reconciliation per linked requirement (through `enqueueReconcile`, so near-simultaneous merges share one job) when the item first becomes merged (or, for an issue, closed as done; `not_planned` does not count), and for each link added to an item that has already finished. A PR that merges with no links at all gets a `link_suggest` job instead. Replaying a delivery therefore changes nothing: the work item is keyed by `(project, source, external_id)`, existing links are skipped, and no state change means no new job. Concurrent deliveries for the same item are serialised by a row lock.
- Jobs run from `/api/jobs/run` (`GET` for Vercel cron, `POST` otherwise), and through Next.js `after()` once the response is sent, so responses stay fast: after connecting a repository, and after every webhook delivery with a valid signature, whether or not it queued anything. Running on every delivery is what picks up retries and jobs cut off by a timeout; when nothing is due it costs one lookup. The cron entry in `vercel.json` is a daily safety net, the most often Vercel's Hobby plan allows. When `CRON_SECRET` is set the route requires it as a bearer token.
- Trade-off: a retry, or the rest of a long import, runs with the next delivery from any connected repository. On an active installation that is soon; when no deliveries arrive it waits for the daily cron. Each run handles at most 20 jobs, so on a quiet installation a repository with thousands of open issues finishes importing over the following runs rather than at once. On a Vercel plan that allows it, a cron every few minutes removes the wait; it was not used here because Hobby rejects it.

## Views

### Product view (`/p/[slug]`)

For sales, leadership and anyone non-technical.

- One card per outcome: plain title, a progress bar, the product status in words ("Partially available: customers can use part of this today"), and the target date.
- Under the status, a list of what customers can use today: one line per finished, user-visible leaf. Each line is the product note on the leaf's latest "done" event, else the requirement's own product note, else its title (`availableToday` in `src/core/roadmap.ts`).
- A "What changed this week" feed built from the last 7 days of events with product notes, each labelled with the outcome it belongs to. Changes under archived outcomes are left out, as they are from split history.
- No ticket numbers by default. The "Show technical detail" toggle is a link to `?detail=1`, so keys are only rendered on request and never sent to the browser otherwise.

### Schedule

Targets are a quarter (`2027-Q1`) or a date (`2027-01-11`), checked by `targetSchema` in `src/core/schedule.ts` wherever they enter: operations, the import agent, the slip check and the plan page. A quarter ends on its last day, so `2027-03-31` is not later than `2027-Q1`. An outcome target saved before targets were validated (for example "H1 2027" typed into an earlier review edit) cannot be compared, so the checks treat it as no target. The warning signs are worked out once, by `scheduleWarnings`, for both the plan page and the slip check. Requirements may have a target too; an unfinished requirement whose target is after its outcome's is late. Lateness is computed on read, like the rollups, never stored.

The product view says "Some of the remaining work is planned after this date, so it may move" under the target, with keys only in technical detail. The technical view shows each requirement's due date and marks late ones "After the outcome's target". The plan page lists them by key.

### Plan (`/p/[slug]/plan`)

For the PM, to reschedule and reprioritise in place.

- Outcomes in priority order. Drag one onto another, or use its Up and Down buttons, which also work from the keyboard and on touch screens. The page sends the outcome it was dropped on, not a position, so a page that is out of date because someone else reordered still puts it where the person meant. Only the header row drags, so text in the target boxes can still be selected and dropped. A move renumbers priorities 1, 2, 3… in the new order, and only the moved outcome gets a product note ("Now comes before “Customers can export reports”."), so a move is one entry in the change feed (`moveOperations` in `src/core/planning.ts`).
- Each outcome's target can be changed in place, with an optional reason for the change feed. The feed shows what moved ("Moved from Q1 2027 to Q2 2027.") followed by the reason. Requirement targets are edited the same way, without a note: they are technical detail.
- Warnings for late requirements and for a target that has passed with work still open.
- Every edit goes through `savePlanningChange`: it saves a `manual` proposal and approves it at once with `applyProposal`, in one transaction, so a person's edits take the same path as the agents' and each has an event. v1 has no sign-in, so the actor is `planner`. A change to an outcome's target, or to the target of any requirement under it, supersedes that outcome's pending `reschedule` proposals and queues a `slip_check`, which runs after the response is sent: the old proposal was judged against dates that have changed, and the check proposes again if the new plan still looks late.

Moves of a target or priority are marked "Plan change" in the product view's change feed (`moved` on each `RecentChange`).

Out of scope: sprints, story points, estimates and task-level scheduling. Those belong to the issue tracker Throughline reads from; Throughline plans at the outcome and requirement level.

### Technical view (`/p/[slug]/tech`)

For engineering.

- An expandable tree (native `<details>`, so it works with the keyboard and without JavaScript): outcome → requirements → children → linked PRs and issues with state badges. Parents start open; leaves open to show their work items.
- Split history: which requirements were split, when and why, from `split_requirement` events.

Both views read the graph through `loadRoadmap`, `loadRecentChanges` and `loadSplitHistory` in `src/core/roadmap.ts`; progress and status come from the rollups. A missing project shows a plain "could not find that project" page and a failed load a "try again" page (`not-found.tsx` and `error.tsx` under `/p/[slug]`). Dates are shown in UTC so they do not depend on the server's time zone. The project lookup runs inside the page's `<Suspense>` boundary, after the shell has streamed, so a missing project is served with status 200 and a `noindex` tag rather than a 404. A real 404 would need a Proxy lookup, and Proxy must not share the app's PGlite client.

### Review queue (`/p/[slug]/review`)

For the PM.

- Pending proposals, newest first, each with its source, the work item that prompted it, a summary, rationale and a readable diff of its operations: current values struck through next to the proposed ones.
- Approve, edit then approve, or reject. Editing offers the fields an edit may change (see "Graph operations").
- Approving goes through `approveProposal` (`src/core/review.ts`): it applies the proposal and, for each work item the proposal links that has already finished, queues a `reconcile` job, just as a PR that references a requirement would. This is how an approved link suggestion leads to reconciliation. Approving a `reconcile` proposal also queues a `slip_check` for its outcome (see "Slip check").
- v1 has no sign-in, so decisions are recorded with the actor `reviewer`.

## Demo mode

A seeded project called "Acme Analytics" lets anyone explore Throughline without signing in or providing an API key. Demo proposals are pre-generated fixtures. "Open demo" on the home page goes straight to it.

`pnpm db:seed` (`src/db/seed.ts`) builds the demo graph by approving proposals, so it has the same event history a real project would, including a planning change that moves one outcome back a quarter and dates for some requirements, then leaves four proposals pending for the review queue, one of them a `reschedule` proposal for an outcome whose bounce-handling work is planned after its target. Running it again replaces the demo project. `/api/demo/reset` does the same inside one transaction, so visitors see the old demo until the new one is complete; a Vercel cron calls it nightly, guarded by `CRON_SECRET`, and refused outright when the secret is unset.

### Public deployment

v1 has no sign-in, so a public site sets `PUBLIC_DEPLOYMENT=true` (`src/lib/public-deployment.ts`). Then:

- Only projects with `is_demo` accept changes. For any other project the import, review, plan and connect server actions refuse with "view-only", and the pages hide their forms.
- Proposals can be approved or rejected but not edited first: the review action refuses edited operations and the Edit button is hidden, so visitors cannot put their own wording on the public demo. For the same reason the plan page takes reorders and new targets on the demo but no free-text reason. The owner changes their own projects from a local copy of the app pointed at the production database (see `docs/DEPLOY.md`).
- Agents for demo projects use `getDemoLLMProvider`: a free model through OpenRouter when `OPENROUTER_API_KEY` is set, with sample results as the fallback, and sample results alone otherwise. They never use the Anthropic key, so visitors cannot spend it. Queued jobs for demo projects do the same, and skip GitHub, with or without the variable: a job a visitor queued may run on the owner's machine, and the demo's repository is made up.
- No repository can be connected from the site.

Without the variable, as when running locally, every project accepts changes and imports use the owner's provider whenever a key is set.

## Moving to production

The public version is built so a private fork can harden it without a rewrite:

- Swap the job table for a real queue (e.g. Inngest, SQS) behind the same `enqueue` function.
- Add organisations, roles and SSO around the existing `projects` table.
- Add `SourceAdapter` implementations for Linear or Jira.
- Add the feedback and research agents listed under "Future work" in `PLAN.md`; they produce proposals like every other agent.
