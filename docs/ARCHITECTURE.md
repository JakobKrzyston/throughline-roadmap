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
6. **Integrations sit behind adapters.** GitHub and Linear are `SourceAdapter`s. Anthropic is one `LLMProvider`. Linear roadmaps are read through a `LinearSource`. Jira or another model provider can be added without touching the core.

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
 MCP clients ──────────► └──────────────────────────┘
 (outside agents)
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

One roadmap workspace. Fields: `id`, `name`, `slug`, `is_demo`, `digest_slack_webhook_url` (where the weekly digest goes; null sends none) and `digest_sent_at` (when it last went out).

### `repositories`

Source repositories connected to a project. A row can also be a connected Linear team. Fields: `project_id`, `source` (`github` or `linear`), `external_id` (GitHub's numeric repository id, which survives renames, or the Linear team's id), `full_name` (`owner/name`, or the Linear team's key such as `ENG`, refreshed from each webhook so it follows renames), `references_ignored` (Linear only: the workspace had a team keyed `TL` when this team was connected, so references in Linear issues are ignored; see "The `TL` key rule"). Webhooks find their project through `(source, external_id)`; one repository may be connected to several projects.

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

| Field                  | Notes                                                                                   |
| ---------------------- | --------------------------------------------------------------------------------------- |
| `id`                   |                                                                                         |
| `project_id`           |                                                                                         |
| `key`                  | e.g. `TL-12`. This is what PRs reference.                                               |
| `outcome_id`           | Set on root requirements only                                                           |
| `parent_id`            | Set on child requirements only. Exactly one of `outcome_id` / `parent_id` is set.       |
| `title`, `description` | Technical language is fine here                                                         |
| `status`               | Leaf only: `planned`, `in_progress`, `done`, `dropped`. Null on parents.                |
| `user_visible`         | True if finishing this gives customers something they can see or use                    |
| `product_note`         | Plain-language explanation shown in the product view                                    |
| `split_reason`         | Why this requirement was split, if it was                                               |
| `target`               | Optional quarter or date, compared with the outcome's target (see "Schedule")           |
| `work_type`            | Optional kind of work: `feature`, `infrastructure`, `security`, `tech_debt`, `research` |
| `team`                 | Optional free-text owning team, e.g. `Platform`. Null inherits the parent's team        |

A requirement's effective team is its own, else the nearest ancestor's. Like status rollups, the inherited team is worked out on read (`loadRoadmap`), never copied onto children, so changing a parent's team moves every piece that has none of its own.

### `work_items`

Mirrors of GitHub issues and pull requests, and of Linear issues.

| Field                    | Notes                                                                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                     |                                                                                                                                                                                 |
| `project_id`             |                                                                                                                                                                                 |
| `source`                 | `github` or `linear` (later `jira`)                                                                                                                                             |
| `external_id`            | e.g. `1043219876#41`: repository id, then number. For Linear, the issue's id                                                                                                    |
| `kind`                   | `issue` or `pull_request`                                                                                                                                                       |
| `identifier`             | Linear only: the issue's id as people see it, such as `ENG-41`, shown in the technical view. Null for GitHub                                                                    |
| `title`, `url`, `state`  | `state`: `open`, `closed`, `merged`, `not_planned` (an issue closed as not planned or duplicate)                                                                                |
| `body_excerpt`           | First part of the description, for agent context                                                                                                                                |
| `merged_at`, `closed_at` |                                                                                                                                                                                 |
| `source_updated_at`      | When the source last changed the item. A delivery older than this is ignored, since webhooks can arrive out of order                                                            |
| `people`                 | Logins of the people working on it: a PR's author and the item's assignees, bots left out (for Linear, the assignee's display name, app users left out). Refreshed on each sync |

People come from the source, never from Throughline: a requirement's people are everyone on the work items linked to it, and Throughline never assigns work. An issue's author only reported it, so only its assignees count. Work items stored before `people` existed have none until GitHub next sends a change for them; queueing a `backfill` job for a repository again refreshes its open issues and recently merged PRs.

### `feedback`

What customers ask for, mirrored from a source: for GitHub, issues labelled `feedback`. Feedback is not a work item, since it is a request rather than work done, so it links to outcomes instead of requirements. Fields: `project_id`, `source`, `external_id` (the same form as a work item's), `title`, `url`, `body_excerpt`, `theme` (a short name for what is asked, from the feedback agent), `withdrawn` (the label was removed; kept so the events that linked it still point at something, and left out of every count), `source_updated_at`.

### `feedback_links`

Many-to-many between feedback and outcomes. Fields: `feedback_id`, `outcome_id`; the pair is the primary key. Changed only by the `link_feedback` and `unlink_feedback` operations.

### `links`

Many-to-many between requirements and work items. Fields: `requirement_id`, `work_item_id`, `relation` (`implements` or `part_of`), `confidence` (`explicit` from a PR reference, or `suggested` from the agent and approved). The pair `(requirement_id, work_item_id)` is the primary key; links have no id of their own.

### `proposals`

The review queue.

| Field                      | Notes                                                                                                                   |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `id`                       |                                                                                                                         |
| `project_id`               |                                                                                                                         |
| `source`                   | `import`, `reconcile`, `link_suggest`, `explicit_link`, `work_started`, `manual`, `reschedule`, `feedback_match`, `mcp` |
| `status`                   | `pending`, `approved`, `rejected`, `superseded`                                                                         |
| `summary`                  | One plain-language line for the queue                                                                                   |
| `rationale`                | Why the agent suggests this                                                                                             |
| `operations`               | JSON array of typed graph operations (see below)                                                                        |
| `trigger_work_item_id`     | The PR or issue that caused it, if any                                                                                  |
| `requirement_id`           | The requirement a `reconcile` proposal is about                                                                         |
| `trigger_feedback_id`      | The feedback a `feedback_match` (or manual feedback link) proposal is about                                             |
| `import_mapping`           | A paired roadmap import's review metadata (see "Paired roadmap import"); null for every other proposal                  |
| `decided_by`, `decided_at` |                                                                                                                         |

### `events`

Append-only audit log. Fields: `id`, `seq`, `project_id`, `type`, `entity_type`, `entity_id`, `actor` (user id or `agent`), `proposal_id`, `payload` (JSON), `product_note`.

`seq` is an identity column that records insertion order. Every event from one approved proposal shares `created_at`, so anything that needs "latest" or "newest first" orders by `seq`.

`type` is the operation type and `payload` is the operation itself. `entity_type` is `outcome` or `requirement`; work item link and unlink events belong to the requirement, and feedback link and unlink events to the outcome.

### `jobs`

A minimal job queue for agent runs. Fields: `id`, `type`, `payload`, `status` (`queued`, `running`, `done`, `failed`), `attempts`, `last_error`, `run_after`.

Job types are `backfill` (`{ repositoryId, mergedSince?, cursor? }`), `reconcile` (`{ workItemId, requirementId }`), `link_suggest` (`{ workItemId }`), `slip_check` (`{ outcomeId }`) and `feedback_match` (`{ feedbackId }`). `enqueue()`, `enqueueReconcile()`, `enqueueSlipCheck()` and `runJobs()` live in `src/jobs/queue.ts`. `enqueueSlipCheck` adds nothing when a check for the same outcome is already queued, since the check reads the outcome as it is when it runs. `enqueueReconcile` folds a reconciliation into a `queued` job for the same requirement instead of adding another, pointing that job at the newest work item: the agent judges the requirement as a whole and sees every work item linked to it, so when several pull requests merge before the first job runs, one run covers them all. A job that is already `running` is left alone, and the new job's proposal supersedes its proposal. A runner claims one job at a time with `FOR UPDATE SKIP LOCKED`, so concurrent runners never share a job. A failed job is retried after a delay, up to three attempts, then marked `failed`. A job left `running` for 15 minutes (for example, cut off by a serverless timeout) is claimed again. Job types without a handler stay `queued`. A handler may return the payload of a follow-up job of the same type; it is queued in the same transaction that marks the job done, so a job cut off before that point never queues its follow-up twice.

## Graph operations

Proposals carry a list of typed operations. Applying a proposal runs them in one transaction and writes one event per operation. Operations are validated with Zod before they reach the database.

| Operation            | Effect                                                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `create_outcome`     | Add a product outcome                                                                                                         |
| `update_outcome`     | Change title, description, target or priority; see below for its event's note                                                 |
| `create_requirement` | Add a root requirement under an outcome, optionally with a target, kind of work, team and status (default `planned`)          |
| `split_requirement`  | Turn a leaf into a parent with N new children (each with an optional kind of work); records `split_reason` and a product note |
| `update_requirement` | Change title, description, `user_visible`, product note, target, kind of work or team (null clears it)                        |
| `set_status`         | Set a leaf's status                                                                                                           |
| `link_work_item`     | Link a work item to a requirement                                                                                             |
| `unlink_work_item`   | Remove a link                                                                                                                 |
| `link_feedback`      | Count a piece of feedback towards a live outcome; refused for withdrawn feedback                                              |
| `unlink_feedback`    | Remove a feedback link                                                                                                        |

Operations name outcomes and requirements by `key` (`OUT-3`, `TL-12`), not by id, so one proposal can create an outcome and then add requirements under it. Work items and feedback are referenced by id because proposals never create them. Feedback links carry no product note: feedback is not a change to the plan, so it stays out of the change feed and the digest. Only leaves can be split or given a status. Each operation's optional `product_note` becomes the event's product note (and, for requirement create/update, the requirement's own note). Outcomes have no note of their own. When an `update_outcome` changes the target, `applyProposal` writes the move ("Moved from Q1 2027 to Q2 2027.", from `describeTargetMove`) from the target the outcome has at that moment, followed by the operation's note as the reason. A proposal made against an older plan, or edited by a reviewer, therefore cannot put a move that did not happen in the change feed.

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
- **Progress by team** (`teamProgress`) counts each team's non-dropped leaves under an outcome and how many are done ("Platform: 3 of 8 done"), using each leaf's effective team. Work no team owns is counted last as "No team". It is shown in the technical view only.

## Linking PRs to requirements

Linear issues link the same way as PRs; the differences are noted below and under "Linear issues as work items".

1. **Explicit:** a PR or Linear issue whose body or title contains `Implements TL-12` or `Part of TL-12` creates a link automatically. This is deterministic and needs no review. Matching is case-insensitive, one phrase can list several keys (`Part of TL-3, TL-4 and TL-5`), and keys that are not in the project are ignored (`src/core/references.ts`). The links still go through a proposal with source `explicit_link`, approved at once by the `github-sync` actor, so `applyProposal` stays the only code that changes the graph and every link has an event. Removing a reference from a PR later does not remove the link.
2. **Suggested:** if a merged PR, or a Linear issue completed inside a Linear project, has no reference, the link agent compares it to the project's requirements and proposes the best match. A person approves it.
3. **Work started:** an open PR, or a Linear issue in a `started` state such as In Progress, that is linked to a `planned` leaf moves it to `in_progress`, through a `work_started` proposal approved at once by `github-sync` (`linear-sync` for Linear), like an explicit link. Requirements that are already started, finished, dropped or split are left alone, GitHub issues never start work, and closing a PR without merging does not move the requirement back. This is what makes an outcome show "in progress" before anything has shipped.

4. **Proposed by an agent:** an agent outside Throughline, such as the one that wrote the PR, calls the MCP server's `propose_link` (see "MCP server"). This makes a pending `mcp` proposal with one `link_work_item` operation, which a person approves like a suggestion.

## MCP server

`/api/mcp` (`src/app/api/mcp/route.ts`) is a [Model Context Protocol](https://modelcontextprotocol.io) server over Streamable HTTP, so an agent outside Throughline can read the roadmap and propose changes to it. It is stateless: each request builds a server with `createMcpServer` (`src/mcp/server.ts`), and replies are plain JSON. Every request must carry `Authorization: Bearer <MCP_TOKEN>`; with `MCP_TOKEN` unset the route answers 503, so the public site, which does not set it, exposes nothing. The token gives access to every project on the instance, so it suits a private instance with one owner until "Teams and permissions" brings per-project access.

| Tool              | Input                                             | What it does                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_requirement` | `project` (slug), `key`                           | Returns the requirement's title, description (where the acceptance criteria are), status (rolled up for a parent), outcome, parent, children and linked work items, read with `loadRoadmap`.                                                                                                                                                                                                                           |
| `propose_link`    | `project`, `pull_request_url`, `key`, `rationale` | Creates a pending `mcp` proposal linking the PR to the requirement with `explicit` confidence, since the agent that wrote the PR says what it is for. The PR must already be a work item, which the GitHub sync makes when it is opened; MCP never creates work items. Returns the waiting proposal if the same link is already pending, and `already_linked` if the link exists, so retries add nothing to the queue. |

Rule 1 holds: neither tool changes the graph, and no tool approves a proposal. The review queue labels `mcp` proposals "Proposed by an agent", and approving one goes through `approveProposal`, so a link to a merged PR queues reconciliation as an approved suggestion does. The approval event's `proposal_id` points at the `mcp` proposal, which is how the history shows a change came from an agent.

## Agents

All agents call `LLMProvider.generateStructured(schema, prompt)` (`src/adapters/llm/`), which returns output that matches a Zod schema.

- `AnthropicProvider` offers Claude a single tool whose input schema is generated from the Zod schema, and reads the answer from the tool call. Current Claude models reject forced `tool_choice`, so the system prompt asks for the call and a reply without one counts as invalid output. The model comes from `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`).
- Output that fails Zod validation is retried **once**: the validation error goes back to the model as a failed tool result. If the second attempt also fails, the provider raises `LLMOutputError`, whose message is shown to the user. Agents write nothing until they have valid output, so a failed run never leaves a partial proposal.
- `OpenRouterProvider` (`src/adapters/llm/openrouter.ts`) does the same against OpenRouter's OpenAI-compatible API with plain `fetch`, so any model there works, including free ones. It asks for a tool call but also accepts JSON in the reply text, since free models do not all honour `tool_choice`. `OPENROUTER_MODEL` is a comma-separated list in fallback order, sent as OpenRouter's `models` parameter so OpenRouter itself moves to the next model when one is rate-limited or down (default: free models with tool calling).
- `FakeLLMProvider` serves fixtures per task name with the same validation and retry. Tests use it, and so does the app when no model key is set (demo mode), so nothing needs an API key.
- `getLLMProvider` (`src/adapters/llm/index.ts`) picks Anthropic when `ANTHROPIC_API_KEY` is set, else OpenRouter when `OPENROUTER_API_KEY` is set, else the fake. `getDemoLLMProvider` is for demo projects, whose agents visitors can trigger: OpenRouter when its key is set, wrapped in `FallbackLLMProvider` so sample results take over when the model is rate-limited or answers badly, and never the Anthropic key.

### Roadmap import agent

Input: pasted text or an uploaded file (a roadmap, meeting notes, a product brief, or a tool's export) from `/p/[slug]/import`. Output: one pending proposal with `create_outcome` and `create_requirement` operations. The prompt asks for customer-facing outcome titles and engineering-facing requirement titles, and marks which requirements are user-visible. It also proposes each requirement's kind of work (`work_type`); a reviewer can change it before approving, and anyone can change it later on the plan page. Each outcome is one result customers would recognise and could be told about on its own: work that delivers the same result is grouped, separate capabilities stay apart even when they share a phase or theme, and the roadmap's layout does not decide the grouping. Internal engineering work (security, refactoring, tooling) goes under the outcome it supports rather than becoming an outcome. Targets must be a quarter (`2027-Q1`) or a date (`2027-01-11`); any other format counts as invalid output.

Most teams keep their roadmap in a spreadsheet, a docs tool (Notion, Confluence, Google Docs) or a planning tool (Jira, Productboard, Aha!, Linear), and nearly all of them export CSV, Markdown or HTML. So the import takes those files as text and gives them to the same agent, with no parser and no per-tool integration. `readRoadmapInput` (`src/lib/roadmap-input.ts`) validates the form at the server action: a file must be `.md`, `.markdown`, `.txt`, `.csv`, `.html` or `.htm` and at most 500 KB, and a file and pasted text together are refused. The form checks the size as well, and clears a file that is too large, because Next.js rejects a request over 1 MB before the action can explain why. It also reports a 0-byte file, which the server cannot tell from a blank file input. The form holds text or a file, never both: typing, loading a sample or choosing a file clears the other. The action checks that the project exists and accepts changes before it reads the file. The file is decoded as UTF-16 when it starts with that byte order mark, else as UTF-8, else as Windows-1252, which is what Excel on Windows saves as CSV; text containing NUL characters is refused as not text. An HTML file is reduced to its text on the server, because exported pages are mostly markup. `htmlToText` keeps headings, list items and table cells apart and decodes the typographic and numeric entities that Confluence and Google Docs use. It is one indexOf pass rather than a parser dependency or regular expressions such as `/<[^>]*>/`, which rescan to the end of the input from every unclosed `<` and would take seconds on a hostile 500 KB file; an unclosed comment, tag or script runs to the end of the input. The 50,000-character limit that applies to pasted text then applies to what is left. The prompt tells the model how exports are shaped: in CSV, type and parent columns (Initiative > Epic > Story, Objective > Feature > Subfeature) show which rows sit under which, but grouping still follows what customers get; date, timeframe, release and priority columns give targets and priorities; issue keys, internal ids, URLs, assignees and scores are ignored and never copied into titles (rule 5); and rows marked won't do, cancelled, duplicate, done or released are left out and named in the rationale, since the import records only planned work. The proposal's summary says "from an uploaded file" without the file's name, since on a shared demo every visitor would read whatever the name says. Anything in the text that reads as a `<roadmap>` tag, including forms like `</roadmap >`, `< /roadmap>` or `<roadmap id=x>`, has its `<` escaped to `&lt;`, so it cannot open or close the data block. Escaping, unlike removing the tags, cannot join the text around a tag into a new one (`<</roadmap>/roadmap>`).

`src/agents/import-samples.ts` holds three realistic exports (a Jira CSV, a Productboard CSV and a Notion Markdown page, with the extra columns, empty cells, ids and finished or abandoned work real exports have) that the import page loads into the paste box. Only the button labels are sent with the page; `loadImportSample`, a server action, fetches a sample's text when its button is clicked. A sample that arrives after a newer click or after the person starts typing is dropped, and a failed load says so. Each has the model output written for it, and `importFixturesFor` serves that output from the fake provider when the submitted text is the sample unchanged, so the samples give a believable proposal with no model key. Any other text gets the generic demo proposal. With a model key, samples go to the model like anything else.

The model does not choose keys. `src/agents/import.ts` numbers new outcomes and requirements after the highest `OUT-n` and `TL-n` already in the project or claimed by a pending proposal, so an import cannot clash with existing work. `saveImportProposal` does this for every import, from the model or from Linear.

### Linear roadmap import

"Import from Linear" on `/p/[slug]/import` reads one Linear team and saves its roadmap as one pending `import` proposal, like any other import. Nothing reaches the graph until it is approved.

- **Adapter.** `LinearSource` (`src/adapters/linear/source.ts`) has two methods: list the workspace's teams, and read one team with all its unarchived projects, each with every initiative it belongs to and every team it is shared with. `LinearApiSource` implements it with `fetch` against Linear's GraphQL API, with no SDK: a handful of queries does not justify the dependency. It follows every cursor before returning, so nothing comes back as a partial list: the team's project pages, and for the rare project in more than ten initiatives or teams, the rest of those through a follow-up query on that project. Every response is validated with Zod. A rejected key, rate limiting, an unreachable API, a GraphQL error or a response of the wrong shape becomes a `LinearError` whose message the page shows. `Query.team` returns `Team!`, so an unknown or deleted team id arrives as an "Entity not found" error, which becomes "That Linear team was not found." `FakeLinearSource` (`fake.ts`) serves a sample Acme Analytics workspace (two teams sharing one project, and three initiatives, with backlog, started, completed and canceled projects among the planned ones). `linearSourceFor` (`index.ts`) uses the API when `LINEAR_API_KEY` is set and the project is not a demo, and the sample otherwise, so the import works with no key and visitors to a demo never read the owner's Linear. Setup is in `docs/LINEAR.md`.
- **Teams load on request.** The import page renders the Linear section without calling Linear; "Choose a Linear team" runs `loadLinearTeams`, a server action, so someone who only pastes or uploads never waits on Linear's pages and timeouts.
- **Mapping without a model.** `planFromLinear` (`src/agents/linear-import.ts`) is a pure function. Linear already stores the hierarchy, dates and priorities as structured data, so a model could only get them wrong: each initiative becomes an outcome and its projects its requirements; a project in no initiative becomes an outcome with itself as the only requirement, since a Linear project is usually one capability that ships on its own; a project in several initiatives goes under the highest-priority one. Outcomes are numbered by Linear priority (none last), then Linear's own order, initiatives first. Each requirement gets the project's target and the team's name as its `team`. Completed and canceled projects and canceled initiatives are left out, as in file imports. Target dates go through `linearTarget`: a day stays a date, a month or quarter becomes its quarter, and a half or year becomes its last quarter.
- **An open project whose initiatives are all canceled** is kept, as an outcome of its own like a project in no initiative, because the project itself is still planned work and dropping it would hide it. The rationale counts these projects separately from those in no initiative and tells the reviewer to leave them out if the work was dropped with the initiative.
- **What the reviewer still decides.** Titles and descriptions are the ones the team wrote in Linear. Initiatives and projects carry no issue keys, so rule 5 is not at risk from ids, but initiative names are often internal shorthand rather than a customer outcome; the rationale asks the reviewer to reword them, and to mark which requirements customers can see, which Linear does not record (every requirement is proposed as not user-visible, the safe default). `work_type` is left empty for the same reason.
- **Not yet.** Importing the same team twice proposes the same outcomes twice; the reviewer rejects the duplicate. Likewise, a project shared by several teams is in each team's import, with that team as its `team`. The graph stores no Linear ids to match on, and Linear's lead-team field is marked internal, so the import does not pick one team; instead the rationale counts the shared projects and names the other teams, so the reviewer approves each only once. The key is per workspace, from the environment; per-project OAuth is a follow-up.

### Paired roadmap import

Teams that already keep a product roadmap and a technical roadmap choose "Product and technical roadmap" on `/p/[slug]/import` and bring both, each pasted or as a file. They get one `import` proposal that links each technical item to the product outcome it delivers, and a person checks every link before anything is saved.

- **Input.** `readPairedRoadmapInput` (`src/lib/roadmap-input.ts`) reads `product_roadmap` or `product_file` and `technical_roadmap` or `technical_file`, each through `readRoadmapInput(formData, prefix)` with the same checks as a single import: 500 KB per file and 50,000 characters per roadmap. Next.js rejects a request over 1 MB before the action runs, so the two files together may be at most 900 KB. The form refuses a second file that would take the total over, and the server checks the total again before reading either file.
- **Record references, not a parser.** `splitRecords` (`src/agents/records.ts`) splits each roadmap into records and the prompt prefixes each with a reference: `P1`, `P2`, … for the product roadmap and `T1`, `T2`, … for the technical one. Text is CSV when its first row has at least two cells and every row has the same number, read with a small quote-aware splitter, so a quoted cell that spans several lines stays in its row. The first row is `P0` or `T0`. It is usually the header, which names the columns, and is then left uncited. But comma-separated text with no header looks the same, so the model may cite that row like any other when it is an item, and the review lists an uncited first row under "Left out" as read as column names, so nothing is dropped unseen. A cell's later lines are indented in the prompt, so a line inside a cell that starts like a reference cannot read as a record of its own. Anything else, Markdown, plain text or a ragged CSV, is split into its non-empty lines. There is no CSV dependency, and Excel users save as CSV as for the single import.
- **What the references guarantee.** `pairedOutputSchemaFor` adds checks to the output schema: every cited reference exists in the right roadmap (outcomes cite product records, requirements and unplaced items technical ones), every record but a header is cited exactly once, and every requirement names an outcome that the output has. An answer with no outcomes passes these checks, since a roadmap whose product items have all shipped may honestly have none, but the agent then says so and saves nothing, because the technical work would have nothing to deliver. So the model cannot invent a row, split one row into several items, or silently drop one. A failed check is a validation error, so the model gets the usual single retry with the problems listed, and nothing is saved until the output passes. References do not stop the model rewording a row, which is why the review shows each item's source rows beside its title.
- **The agent** (`src/agents/paired-import.ts`). Outcomes come from the product roadmap and requirements from the technical roadmap, titled in the team's own words without issue keys or ids (rule 5); the single import still rewrites titles into customer language, but here the team has already chosen its wording. Each requirement names its outcome, a confidence (`high` when the roadmaps link the two through a shared name, epic, parent or theme, `low` when the model inferred it), a one-line reason and the records it came from. A product item with no technical work becomes an outcome with no requirements, so the product view shows it as not started. A technical item that delivers no outcome, such as upkeep, is **not placed**: it is listed with a suggested outcome, or none, for the reviewer to place. Left-out entries name their records and a reason: won't do, cancelled, duplicate, already shipped, or not planned work (a document title or heading in a Markdown roadmap).
- **Existing status.** Technical rows marked in progress or done are imported with that status through `create_requirement`'s optional `status`, so outcome progress is right from day one. A product item that has already shipped is left out together with all its technical rows: without them it would be an outcome with no requirements, which `productStatus` reads as not started. A partly shipped item is kept, with its done rows imported as done. The agent appends what was left out, and why, to the rationale itself, so the reviewer always sees it.
- **Storage.** The proposal's operations are its outcomes first, then requirements in their outcomes' order, so any requirement can move to any outcome the proposal creates. `import_mapping` (`importMappingSchema` in `src/core/import-mapping.ts`) holds the review metadata: each cited record's text and the headers, each outcome's and requirement's records, each requirement's confidence and reason, the unplaced items and the left-out entries. It is not a graph operation. Unplaced items get their `TL-n` keys when the proposal is saved, held in the mapping, and `lastKeyNumbers` counts them (reading only those keys, not the stored roadmap text), so placing one later cannot clash with another proposal.
- **Demo.** `PAIRED_SAMPLE` in `src/agents/import-samples.ts` is an Acme Analytics product roadmap CSV and a Jira technical roadmap CSV, one of whose descriptions spans several lines, with fixture output that has a low-confidence link, an outcome with no plan, a done requirement, a shipped product item left out with its rows, and two unplaced items: one with a suggested outcome and one, "Upgrade Postgres", with none. The fixture cites the sample's own records, so it is served only for the sample: with no model the action imports only the sample and explains why for anything else, and on the public demo a failed model call for other roadmaps reports a plain failure rather than reference errors about rows the visitor never wrote.

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

New pieces of a split get a proposed kind of work, and inherit the requirement's team. The prompt includes the requirement's own kind of work to guide that choice. Zod checks that the answer is consistent (a split for the two split classifications, at least one piece still to do, and so on), so an inconsistent answer gets the usual single retry. As with the import, the agent numbers new pieces itself after the highest `TL-n` in use.

Every proposal it makes includes a product note in plain language, for example: "Export took longer because it needed new background-job infrastructure, which also unblocks scheduled reports."

The proposal records its `requirement_id`. Saving it marks any older pending `reconcile` proposal for the same requirement `superseded` (decided by `agent`): the newer one was made with more of the work in view, since it sees every work item linked so far, and the prompt asks for a verdict on the requirement as a whole.

### Slip check

`src/agents/slip.ts`. Approving a `reconcile` proposal changes what is left to do under an outcome, so `approveProposal` queues a `slip_check` job for that outcome. The check first looks for a warning sign without the model (`loadSlipContext`): an unfinished requirement whose target is after the outcome's (`lateRequirements` in `src/core/schedule.ts`), or an outcome target that has passed while work is still open. An outcome with no target, no open work or no warning sign is left alone and the model is not called.

Otherwise the model sees the outcome, today's date, every requirement under it with its status, target and split reason, and the warning signs. It answers with a new target, or null when the late work is not needed for customers to get the outcome. Zod checks that a new target is a quarter or a date, later than the current one, no earlier than the latest late requirement, and not already past, and that the reason does not open by repeating the move ("Moved from … to …"), so an impossible answer or a reason that would say the dates twice gets the usual single retry. The reason is stored as the model wrote it. A new target becomes a pending `reschedule` proposal with one `update_outcome` operation. The agent writes only the reason ("Handling bounced emails turned out to be its own piece of work."); the move itself is added to the note when the proposal is applied (see "Graph operations"). Every run supersedes the older pending `reschedule` proposals for the outcome, whatever it concludes: a new proposal was made with more in view, and when there is no warning sign any more, or the model keeps the target, an old one would slip an outcome that is on track. A run whose model output is invalid changes nothing.

Trade-off: the check runs when reconciled work changes the plan, not when time passes. An outcome whose target passes with no merges is flagged the next time its work is reconciled. A daily check would cover that once there is a cron that runs often enough.

### Link suggestion agent

`src/agents/link-suggest.ts`. Runs as a `link_suggest` job when a PR merges with no link at all (not during a backfill). The model sees the PR's title, description and changed files, and the leaf requirements that are not dropped, with their outcomes. Finished requirements stay in, since a fix to finished work belongs with it. A project with more than `MAX_CANDIDATES` (40) leaves is narrowed first by `rankCandidates`: requirements are scored by how many of their words appear in the PR's title, description and changed files, ties go to unfinished work, and the prompt says how many were left out so the model knows to answer null when the right one is missing. This keeps the prompt bounded on large roadmaps; a retrieval index is the next step if word overlap proves too crude. The answer must be one of those keys, or null when nothing fits well. A match becomes a pending `link_suggest` proposal with a `suggested` link; no match proposes nothing. A PR that has been linked since, or already has a pending suggestion, is skipped. If the PR later gains an explicit reference, the sync marks its pending suggestion `superseded`.

### Feedback agent

`src/agents/feedback-match.ts`. Runs as a `feedback_match` job the first time a piece of feedback arrives, from a webhook or a backfill. It skips feedback that has been withdrawn, linked by hand since, or already has a pending match, and checks again under the feedback's row lock before saving, since the label can be removed or a person can link it while the model answers (withdrawal and manual links take the same lock). The model sees the project's live outcomes, the themes already in use (up to `MAX_THEMES`, 50, the most common first) and the feedback inside `<feedback>` tags it is told to treat as data. It answers with two things:

- **A theme**: two to six plain words for what the customer is asking for ("Dark mode"), reusing an existing theme when the ask is the same. Offering the existing themes is what clusters the feedback: each new piece joins a group or starts one, without a separate clustering pass. A theme that matches an existing one apart from case takes the existing spelling.
- **An outcome key**, one of the live outcomes, or null when delivering none of them would answer the feedback. The prompt says that being in the same area is not enough, since a wrong match hides a gap.

The theme is saved on the feedback straight away. It is a grouping label, not part of the roadmap: it changes neither view, and turning a gap into an outcome is still an import or a planning change that a person makes. A match becomes a pending `feedback_match` proposal with one `link_feedback` operation, so a person decides whether the feedback counts towards that outcome. No match proposes nothing, and the feedback shows as a gap.

Trade-off: feedback is matched once, against the outcomes that exist when it arrives. When a gap later gets its own outcome, its feedback is linked by hand from the feedback page rather than matched again.

## GitHub integration

- A **GitHub App** with read access to issues, pull requests, contents and metadata, subscribed to `issues` and `pull_request` events. Setup steps are in `docs/GITHUB_APP.md`.
- An issue labelled `feedback` (in any case) is customer feedback, not a work item. `issueToItem` in the GitHub adapter makes that call, so the core only sees a `SourceFeedback` (`kind: "feedback"`) beside `SourceWorkItem`s; a support or CRM source would deliver nothing but feedback. `syncRepositoryItem` and the backfill hand feedback to `syncFeedback`, which stores it, ignores deliveries older than the stored copy like `syncWorkItem` does, and queues a `feedback_match` job the first time it arrives. The backfill imports open feedback issues and matches them, unlike finished work, since what customers are still asking for is news. When the label is removed, the next delivery is an ordinary issue: `syncWorkItem` marks the feedback `withdrawn` and supersedes its pending match, and putting the label back counts it again and queues a new match. GitHub does not deliver in order, so an issue delivery older than the issue's stored feedback (from before the label was added) is skipped rather than stored as a work item. Closing a feedback issue does not withdraw it, since the ask was still made. A copy of the issue stored as a work item before it was labelled is left as it is.
- `SourceAdapter` (`src/adapters/source.ts`) is the interface a source implements: look up a repository, list the items to backfill a page at a time, and list a PR's changed files for the agents. `GitHubAdapter` (`src/adapters/github/`) implements it with Octokit, authenticated as the app installation on each repository. Webhook signature checks and payload parsing also live there, and both webhook payloads and REST responses are validated with the same Zod schemas.
- Repositories are connected on `/p/[slug]/settings`. Connecting checks that the repository's owner is in `GITHUB_ALLOWED_OWNERS` (v1 has no sign-in, so this stands in for permissions until #11) and that the app is installed on it, stores it, and enqueues a **backfill**: open issues plus PRs merged in the last 90 days. The backfill links explicit references but queues no reconciliation, since that work finished before Throughline was watching. It runs one page (up to 100 items) per job: each job syncs its page and returns the next page's job, carrying the source's cursor and the cut-off date the first page chose. A run therefore does a bounded amount of work, and a retry repeats only the page that failed. The settings page shows each repository's import as in progress, retrying (with the error), or failed (with the error), from its newest backfill job.
- `POST /api/github/webhook` verifies the `X-Hub-Signature-256` header against the raw body (401 if it does not match), then hands the work item to `syncWorkItem` (`src/core/work-items.ts`) for every project the repository is connected to.
- `syncWorkItem` upserts the work item, creates explicit links, starts work on the planned requirements an open PR is linked to, and queues a reconciliation per linked requirement (through `enqueueReconcile`, so near-simultaneous merges share one job) when the item first becomes merged (or, for an issue, closed as done; `not_planned` does not count), and for each link added to an item that has already finished. A PR that merges with no links at all gets a `link_suggest` job instead. Replaying a delivery therefore changes nothing: the work item is keyed by `(project, source, external_id)`, existing links are skipped, and no state change means no new job. Concurrent deliveries for the same item are serialised by a row lock.
- Jobs run from `/api/jobs/run` (`GET` for Vercel cron, `POST` otherwise), and through Next.js `after()` once the response is sent, so responses stay fast: after connecting a repository, and after every webhook delivery with a valid signature, whether or not it queued anything. Running on every delivery is what picks up retries and jobs cut off by a timeout; when nothing is due it costs one lookup. The cron entry in `vercel.json` is a daily safety net, the most often Vercel's Hobby plan allows. When `CRON_SECRET` is set the route requires it as a bearer token.
- Trade-off: a retry, or the rest of a long import, runs with the next delivery from any connected repository. On an active installation that is soon; when no deliveries arrive it waits for the daily cron. Each run handles at most 20 jobs, so on a quiet installation a repository with thousands of open issues finishes importing over the following runs rather than at once. On a Vercel plan that allows it, a cron every few minutes removes the wait; it was not used here because Hobby rejects it.

## Linear issues as work items

A connected Linear team is the second source of work items. Teams that plan in Throughline but assign and track work in Linear get the same tracking as GitHub: starting an issue starts the requirements it is linked to, and completing one leads to reconciliation, like a merged PR. Throughline only reads from Linear; it never creates, assigns or changes issues.

- **Adapter.** `LinearAdapter` (`src/adapters/linear/adapter.ts`) is a `SourceAdapter` that shares the roadmap import's GraphQL request function, `linearQuery` (`client.ts`), and its errors. A team is found by its key, case-insensitively, and stored as a `repositories` row with `source = 'linear'`, the team's id as `external_id` and its key as `full_name`. An issue's stable Linear id is its `external_id`. `issueToWorkItem` maps Linear's state types: `completed` is `closed` (done), `canceled` and `duplicate` are `not_planned`, `started` is `open` with `started` set, and anything else, including types Linear adds later, is `open`. The assignee is the one person, by display name, and app users such as agents are left out. `updatedAt` orders deliveries, as for GitHub. `FakeLinearAdapter` (`fake-adapter.ts`) serves a sample team (`ENG`) for demo projects and tests; it is separate from the roadmap import's `FakeLinearSource`, so the two samples do not mix. `linearAdapterFor` returns the fake for a demo project, the real adapter when `LINEAR_API_KEY` is set, and nothing otherwise.
- **Linear-only fields.** `SourceWorkItem` gains three optional fields that only Linear sets: `started` (the issue is in a started state), `inProject` (it belongs to a Linear project) and `identifier` (`ENG-41`, stored on the work item). They are optional so GitHub's items, and every GitHub test, are exactly as before: for GitHub an open PR is what shows work has started (`hasStarted` in `src/core/work-items.ts`).
- **No changed files.** A Linear issue has none, so `listChangedFiles` returns nothing and the agents read its title and description, as they do for any issue.
- **Connecting and backfill.** A team is connected on `/p/[slug]/settings` by its key. The backfill uses the same job as GitHub's, a page of 50 issues per job: open issues (any state but completed, canceled or duplicate) plus issues completed in the last 90 days. The job runner picks the backfill's adapter by the repository row's `source`. The agents need no Linear adapter, since an issue has no changed files to fetch.
- **Connecting.** `connectLinearTeam` only connects a team listed in `LINEAR_ALLOWED_TEAMS` (checked before Linear is read, like `GITHUB_ALLOWED_OWNERS`), except the sample team on a demo project.
- **Webhook.** `POST /api/linear/webhook` checks the `Linear-Signature` header, a hex HMAC-SHA256 of the raw body with `LINEAR_WEBHOOK_SECRET`, and then the payload's `webhookTimestamp`, which must be within a minute of now so a captured delivery cannot be replayed later (401 for either). The delivery is only used for the issue's and team's ids. When the team is connected, or the issue is already tracked, the issue is then read fresh from Linear, because the webhook payload does not say whether the assignee is an app user, and so the backfill and the webhook map one shape. A retried delivery therefore syncs the issue as it is now, which changes nothing that is already up to date. The issue is synced into every project its current team is connected to and every project that already tracks it, so an issue moved to a team that is not connected keeps updating where it was tracked. Removed issues and other kinds of delivery are ignored. If Linear cannot be read the route answers 503 and Linear retries.
- **The `TL` key rule.** Requirement keys are always `TL-n`, and a Linear issue id is the team's key and a number. Only a team keyed `TL` has issue ids that look like requirement keys (`collidesWithRequirementKeys` in `src/core/references.ts`), but once a workspace has one, "Part of TL-12" in any team's issue may name that team's issue. So when a team is connected, `connectLinearTeam` also looks for a `TL` team in the workspace and stores the answer as `repositories.references_ignored`. `syncWorkItem` ignores explicit references in a Linear issue when any of the project's Linear teams has the flag, and the settings page says links come from suggestions only. The check is made once, at connection: a `TL` team created later is not noticed.
- **Link suggestions.** They run for an unreferenced Linear issue that completes inside a Linear project. Issues outside any project, which are most bugs and chores, are tracked but get no suggestion, so a busy team does not flood `/review`. GitHub issues still get none.
- **One piece of work, one reconciliation.** Linear often attaches the PR that fixes an issue, so the issue and the PR can both reach the same requirement. No extra de-duplication is needed: `enqueueReconcile` folds both into one job when they finish before it runs; otherwise the later proposal supersedes the earlier pending one, and once one is approved the requirement is done and reconcile skips it. `src/core/work-items-linear.test.ts` shows all three.
- **Not yet.** Per-project Linear OAuth is a follow-up, as for the import.
- **Labels.** The technical view names a Linear issue by its `identifier`, such as `ENG-41`, since the stored external id is opaque.

## Views

### Product view (`/p/[slug]`)

For sales, leadership and anyone non-technical.

- At the top, how many outcomes are delivered, partially available, in progress and not started (`statusCounts` in `src/core/rollup.ts`).
- Outcomes grouped by the quarter of their target, earliest first, with undated outcomes last (`groupByQuarter` in `src/core/roadmap.ts`). A date target falls in its quarter and sorts before the quarter-only targets in it.
- One card per outcome: plain title, the target, a progress bar in the status colour, and the product status in words ("Partially available: customers can use part of this today").
- Under the status, a list of what customers can use today: one line per finished, user-visible leaf. Each line is the product note on the leaf's latest "done" event, else the requirement's own product note, else its title (`availableToday` in `src/core/roadmap.ts`). A collapsed "Still to come" list does the same for planned and in-progress leaves: user-visible ones by product note or title, behind-the-scenes ones only when they have a product note, since their titles are technical (`stillToCome`).
- A "What changed this week" feed built from the last 7 days of events with product notes, grouped by day, each labelled with its kind (shipped, dropped, replanned, split, added or updated, from the event's operation) and the outcome it belongs to. Changes under archived outcomes are left out, as they are from split history. On a wide page the feed sits beside the outcomes.
- No ticket numbers by default. The "Show technical detail" toggle is a link to `?detail=1`, so keys are only rendered on request and never sent to the browser otherwise.

### Schedule

Targets are a quarter (`2027-Q1`) or a date (`2027-01-11`), checked by `targetSchema` in `src/core/schedule.ts` wherever they enter: operations, the import agent, the slip check and the plan page. A quarter ends on its last day, so `2027-03-31` is not later than `2027-Q1`. An outcome target saved before targets were validated (for example "H1 2027" typed into an earlier review edit) cannot be compared, so the checks treat it as no target. The warning signs are worked out once, by `scheduleWarnings`, for both the plan page and the slip check. Requirements may have a target too; an unfinished requirement whose target is after its outcome's is late. Lateness is computed on read, like the rollups, never stored.

The product view says "Some of the remaining work is planned after this date, so it may move" under the target, with keys only in technical detail. The technical view shows each requirement's due date and marks late ones "After the outcome's target". The plan page lists them by key.

### Plan (`/p/[slug]/plan`)

For the PM, to reschedule and reprioritise in place.

- Outcomes in priority order. Drag one onto another, or use its Up and Down buttons, which also work from the keyboard and on touch screens. The page sends the outcome it was dropped on, not a position, so a page that is out of date because someone else reordered still puts it where the person meant. Only the header row drags, so text in the target boxes can still be selected and dropped. A move renumbers priorities 1, 2, 3… in the new order, and only the moved outcome gets a product note ("Now comes before “Customers can export reports”."), so a move is one entry in the change feed (`moveOperations` in `src/core/planning.ts`).
- Each outcome's target can be changed in place, with an optional reason for the change feed. The feed shows what moved ("Moved from Q1 2027 to Q2 2027.") followed by the reason. Requirement targets are edited the same way, without a note: they are technical detail.
- Each requirement's kind of work and team can be set in place. Only the fields that changed go into the `update_requirement` operation, and there is no product note, so these changes stay out of the product view's feed. An empty team box clears the requirement's own team, and its placeholder shows the team it then inherits. On a public deployment team names are free text from visitors, so, like the reason for a move, they cannot be changed there; the kind of work, a fixed list, still can.
- Warnings for late requirements and for a target that has passed with work still open.
- Every edit goes through `savePlanningChange`: it saves a `manual` proposal and approves it at once with `applyProposal`, in one transaction, so a person's edits take the same path as the agents' and each has an event. v1 has no sign-in, so the actor is `planner`. A change to an outcome's target, or to the target of any requirement under it, supersedes that outcome's pending `reschedule` proposals and queues a `slip_check`, which runs after the response is sent: the old proposal was judged against dates that have changed, and the check proposes again if the new plan still looks late.

Moves of a target or an outcome's priority are marked "Replanned" in the product view's change feed (`kind` on each `RecentChange`).

Out of scope: sprints, story points, estimates and task-level scheduling. Those belong to the issue tracker Throughline reads from; Throughline plans at the outcome and requirement level.

### Technical view (`/p/[slug]/tech`)

For engineering.

- An expandable tree (native `<details>`, so it works with the keyboard and without JavaScript): outcome → requirements → children → linked PRs and issues with state badges. Parents start open; leaves open to show their work items.
- Each requirement shows its kind of work and its own team (an inherited team is on the parent's row), and an open row lists the people on its linked work items.
- Under each outcome, progress by team, once any requirement under it has a team.
- Filters for kind of work, team and person, as a plain `GET` form (`?type=…&team=…&person=…`). A requirement shows when it matches every filter that is set, or when something under it does, so a match always appears under the requirements it was split from; outcomes with no match are hidden (`visibleKeys` in `src/core/breakdown.ts`). Progress badges still count the whole tree. Unknown filter values are ignored.
- Split history: which requirements were split, when and why, from `split_requirement` events.

Teams and people are never shown in the product view: they help engineering find who to ask, and the product view is about what customers get. Workload balancing and per-person reports are out of scope.

Both views read the graph through `loadRoadmap`, `loadRecentChanges` and `loadSplitHistory` in `src/core/roadmap.ts`; progress and status come from the rollups. A missing project shows a plain "could not find that project" page and a failed load a "try again" page (`not-found.tsx` and `error.tsx` under `/p/[slug]`). Dates are shown in UTC so they do not depend on the server's time zone. The project lookup runs inside the page's `<Suspense>` boundary, after the shell has streamed, so a missing project is served with status 200 and a `noindex` tag rather than a 404. A real 404 would need a Proxy lookup, and Proxy must not share the app's PGlite client.

### Weekly digest

For people who do not open Throughline: every Monday a plain-language summary goes to a Slack channel. It has two parts, built by `buildDigest` in `src/core/digest.ts`: the changes since the last digest went out (the past week before the first one, so a failed or skipped week is never lost), oldest first and each labelled with its outcome, then one line per outcome with its product status, progress and target. It lists at most 30 changes, the newest, and says when there were earlier ones. The link at the end goes to the product view, on the production domain when `VERCEL_PROJECT_PRODUCTION_URL` is set (`appOrigin` in `src/lib/app-origin.ts`), so a digest sent from a preview deploy still links to the real site. Like the product view, it has no ticket numbers.

- **No model writes it.** The product notes on events are already plain language and were approved by a person, so the digest is a template over them. A model-written summary would put unreviewed text in front of leadership, which design rule 1 is there to prevent.
- **Setup** is on `/p/[slug]/settings`: paste a Slack incoming webhook URL, and Throughline sends the digest so far at once and saves the URL only if Slack accepts it. That send does not count as the week's digest, so the next Monday's still goes out. Only `https://hooks.slack.com/services/` URLs are accepted, so the server posts nowhere else. The page shows whether a digest is set up and when it last went out, never the URL, since anyone holding it can post to the channel. "Stop sending" forgets the URL.
- **Sending** is `GET /api/digests/send`, which a Vercel cron calls at 08:00 UTC on Mondays. Like `/api/demo/reset`, it requires `CRON_SECRET` and refuses every request when it is unset. `sendDueDigests` sends to each project with a webhook and no digest in the last six days (six, not seven, so a cron that fires early still sends). It claims each project by setting `digest_sent_at` before posting, so a cron that fires twice sends once; a failed post puts the old value back, logs the error and moves on to the next project.
- Slack sits behind `src/adapters/slack.ts` (`postToSlack`, plain `fetch`). It escapes `&`, `<` and `>`, so a note cannot ping the channel or add a link. Email would be a second function of the same shape, `DigestPoster` in `src/core/digest.ts`.

### Feedback (`/p/[slug]/feedback`)

For the PM, to see customer pull and gaps. Built by `loadFeedbackBoard` and the pure `groupFeedback` in `src/core/feedback.ts`, from feedback that is not withdrawn.

- **Asked for, by outcome**: every live outcome with the feedback linked to it, the most asked-for first (ties in priority order). Each piece of feedback shows its theme and can be unlinked.
- **Waiting for review**: unlinked feedback with a pending match, and the outcome it names.
- **Not on the roadmap**: the rest, grouped by theme, largest group first, with feedback the agent has not sorted yet last. Each piece can be linked to an outcome from a picker.

Linking and unlinking by hand go through `saveFeedbackLink`: a `manual` proposal approved at once, like a planning change, so each has an event. Linking supersedes the feedback's pending match. v1 has no sign-in, so the actor is `planner`. The product view does not show feedback.

### Review queue (`/p/[slug]/review`)

For the PM.

- Pending proposals, newest first, each with its source, the work item that prompted it, a summary, rationale and a readable diff of its operations: current values struck through next to the proposed ones.
- Approve, edit then approve, or reject. Editing offers the fields an edit may change (see "Graph operations").
- A proposal with an `import_mapping` shows a mapping review in place of the diff (`mapping-review.tsx`). Requirements are grouped under their outcomes, with low-confidence links marked and their reasons shown, and every item shows its source rows under the CSV header. A select on each requirement moves it to another outcome in the proposal or a live outcome already in the project; `applyProposal` refuses an archived one. "Needs a home" lists the unplaced items, each placed under an outcome or left out; "Left out" lists what the import left out and why, for reading only. Approve stays disabled until every unplaced item is placed or left out, and the server refuses too, since the form cannot be trusted. In edit mode the mapping review stays below the editors, so items can still be placed. The choices go to `applyProposal` as mapping decisions, not edits: `resolveImportMapping` changes a moved requirement's `outcome_key` (the one change to what a proposal touches that a reviewer can make) and adds a placed item as a `create_requirement` after the outcomes, and the operations it returns are applied and stored on the proposal. Every requirement still serves an outcome: there is no hidden "internal" outcome.
- Approving goes through `approveProposal` (`src/core/review.ts`): it applies the proposal and, for each work item the proposal links that has already finished, queues a `reconcile` job, just as a PR that references a requirement would. This is how an approved link suggestion leads to reconciliation. Approving a `reconcile` proposal also queues a `slip_check` for its outcome (see "Slip check").
- v1 has no sign-in, so decisions are recorded with the actor `reviewer`.

## Demo mode

A seeded project called "Acme Analytics" lets anyone explore Throughline without signing in or providing an API key. Demo proposals are pre-generated fixtures. "Open demo" on the home page goes straight to it.

`pnpm db:seed` (`src/db/seed.ts`) builds the demo graph by approving proposals, so it has the same event history a real project would, including a planning change that moves one outcome back a quarter and dates for some requirements, then leaves five proposals pending for the review queue, one of them a `reschedule` proposal for an outcome whose bounce-handling work is planned after its target and one a `feedback_match`. It also adds nine pieces of feedback: five linked to outcomes, one waiting for review and three gaps in two themes. Running it again replaces the demo project. `/api/demo/reset` does the same inside one transaction, so visitors see the old demo until the new one is complete; a Vercel cron calls it nightly, guarded by `CRON_SECRET`, and refused outright when the secret is unset.

### Public deployment

v1 has no sign-in, so a public site sets `PUBLIC_DEPLOYMENT=true` (`src/lib/public-deployment.ts`). Then:

- Only projects with `is_demo` accept changes. For any other project the import, review, plan, feedback and connect server actions refuse with "view-only", and the pages hide their forms.
- Proposals can be approved or rejected but not edited first: the review action refuses edited operations and the Edit button is hidden, so visitors cannot put their own wording on the public demo. A paired import's moves and placements are allowed, since they only choose between outcomes. For the same reason the plan page takes reorders and new targets on the demo but no free-text reason. The owner changes their own projects from a local copy of the app pointed at the production database (see `docs/DEPLOY.md`).
- Agents for demo projects use `getDemoLLMProvider`: a free model through OpenRouter when `OPENROUTER_API_KEY` is set, with sample results as the fallback, and sample results alone otherwise. They never use the Anthropic key, so visitors cannot spend it. Queued jobs for demo projects do the same, and skip GitHub, with or without the variable: a job a visitor queued may run on the owner's machine, and the demo's repository is made up.
- No repository can be connected and no digest set up from the site. The owner does both from a local copy; a digest saved that way links to the local copy in its first message only, since the weekly cron links to the domain it called.

Without the variable, as when running locally, every project accepts changes and imports use the owner's provider whenever a key is set.

## Moving to production

The public version is built so a private fork can harden it without a rewrite:

- Swap the job table for a real queue (e.g. Inngest, SQS) behind the same `enqueue` function.
- Add organisations, roles and SSO around the existing `projects` table.
- Add a `SourceAdapter` for Jira, so its issues are tracked as work items like GitHub's and Linear's, and per-project Linear OAuth in place of the server-wide key.
- Add support and CRM feedback sources, and the research agent listed under "Future work" in `PLAN.md`; they produce proposals like every other agent.
