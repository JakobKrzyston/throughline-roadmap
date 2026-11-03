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

### `work_items`

Mirrors of GitHub issues and pull requests.

| Field                    | Notes                                            |
| ------------------------ | ------------------------------------------------ |
| `id`                     |                                                  |
| `project_id`             |                                                  |
| `source`                 | `github` (later `linear`, `jira`)                |
| `external_id`            | e.g. `JakobKrzyston/throughline-roadmap#41`      |
| `kind`                   | `issue` or `pull_request`                        |
| `title`, `url`, `state`  | `state`: `open`, `closed`, `merged`              |
| `body_excerpt`           | First part of the description, for agent context |
| `merged_at`, `closed_at` |                                                  |

### `links`

Many-to-many between requirements and work items. Fields: `requirement_id`, `work_item_id`, `relation` (`implements` or `part_of`), `confidence` (`explicit` from a PR reference, or `suggested` from the agent and approved).

### `proposals`

The review queue.

| Field                      | Notes                                            |
| -------------------------- | ------------------------------------------------ |
| `id`                       |                                                  |
| `project_id`               |                                                  |
| `source`                   | `import`, `reconcile`, `link_suggest`            |
| `status`                   | `pending`, `approved`, `rejected`, `superseded`  |
| `summary`                  | One plain-language line for the queue            |
| `rationale`                | Why the agent suggests this                      |
| `operations`               | JSON array of typed graph operations (see below) |
| `trigger_work_item_id`     | The PR or issue that caused it, if any           |
| `decided_by`, `decided_at` |                                                  |

### `events`

Append-only audit log. Fields: `id`, `project_id`, `type`, `entity_type`, `entity_id`, `actor` (user id or `agent`), `proposal_id`, `payload` (JSON), `product_note`.

### `jobs`

A minimal job queue for agent runs. Fields: `id`, `type`, `payload`, `status` (`queued`, `running`, `done`, `failed`), `attempts`, `last_error`, `run_after`.

## Graph operations

Proposals carry a list of typed operations. Applying a proposal runs them in one transaction and writes one event per operation. Operations are validated with Zod before they reach the database.

| Operation            | Effect                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `create_outcome`     | Add a product outcome                                                                    |
| `update_outcome`     | Change title, description, target or priority                                            |
| `create_requirement` | Add a root requirement under an outcome                                                  |
| `split_requirement`  | Turn a leaf into a parent with N new children; records `split_reason` and a product note |
| `update_requirement` | Change title, description, `user_visible` or product note                                |
| `set_status`         | Set a leaf's status                                                                      |
| `link_work_item`     | Link a work item to a requirement                                                        |
| `unlink_work_item`   | Remove a link                                                                            |

Because a proposal is just data, the review UI can show it as a readable diff and the PM can edit it before approving.

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

1. **Explicit:** a PR body or title containing `Implements TL-12` or `Part of TL-12` creates a link automatically. This is deterministic and needs no review.
2. **Suggested:** if a merged PR has no reference, the link agent compares it to open requirements and proposes the best match. A person approves it.

## Agents

All agents call `LLMProvider.generateStructured(schema, prompt)`, which uses Claude's tool use to return JSON that matches a Zod schema. Tests use a `FakeLLMProvider` that returns fixtures, so the test suite never needs an API key.

### Roadmap import agent

Input: pasted text or Markdown (a roadmap, meeting notes, a product brief). Output: one proposal with `create_outcome` and `create_requirement` operations. The prompt asks for customer-facing outcome titles and engineering-facing requirement titles, and marks which requirements are user-visible.

### Reconciliation agent

Triggered when a linked PR merges or a linked issue closes. It gathers:

- the requirement, its parent chain and its outcome
- the PR title, body, list of changed files and a size-limited diff summary
- sibling requirements and their statuses

It classifies the result as one of:

- `fully_done`: propose `set_status(done)`
- `partially_done`: propose a split into the part that shipped (done) and the part that remains (planned)
- `done_differently`: propose `update_requirement` describing what was actually built
- `scope_grew`: propose a split into the newly discovered pieces

Every proposal it makes includes a product note in plain language, for example: "Export took longer because it needed new background-job infrastructure, which also unblocks scheduled reports."

### Link suggestion agent

Described above. Runs on merged PRs with no explicit reference.

## GitHub integration

- A **GitHub App** with read access to issues, pull requests, contents and metadata, subscribed to `issues` and `pull_request` events.
- `POST /api/github/webhook` verifies the `X-Hub-Signature-256` header, upserts the work item, creates explicit links, and enqueues agent jobs.
- Agent jobs run from `POST /api/jobs/run`, called right after the webhook and on a Vercel cron schedule as a safety net. This keeps webhook responses fast.
- A one-time **backfill** imports existing open issues and recently merged PRs when a repo is connected.

## Views

### Product view (`/p/[slug]`)

For sales, leadership and anyone non-technical.

- One card per outcome: plain title, a progress bar, the product status in words ("Partially available: customers can export to CSV today"), and the target date.
- A "What changed this week" feed built from events with product notes.
- No ticket numbers by default. A "Show technical detail" toggle reveals them.

### Technical view (`/p/[slug]/tech`)

For engineering.

- An expandable tree: outcome → requirements → children → linked PRs and issues with state badges.
- Split history: which requirements were split, when and why.

### Review queue (`/p/[slug]/review`)

For the PM.

- Pending proposals, newest first, each with a summary, rationale and a readable diff of its operations.
- Approve, edit then approve, or reject.

## Demo mode

A seeded project called "Acme Analytics" lets anyone explore Throughline without signing in or providing an API key. Demo proposals are pre-generated fixtures. The demo resets on a schedule.

## Moving to production

The public version is built so a private fork can harden it without a rewrite:

- Swap the job table for a real queue (e.g. Inngest, SQS) behind the same `enqueue` function.
- Add organisations, roles and SSO around the existing `projects` table.
- Add `SourceAdapter` implementations for Linear or Jira.
- Add the feedback and research agents listed under "Future work" in `PLAN.md`; they produce proposals like every other agent.
