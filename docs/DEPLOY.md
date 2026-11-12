# Deploying Throughline

This guide puts Throughline on Vercel with a Neon Postgres database, as a public site anyone can open without signing in. It takes about 20 minutes. You need accounts on [Vercel](https://vercel.com), [Neon](https://neon.tech) and GitHub, and a local clone that runs (see the README). Everything in it fits the free tiers; see [Running it for free](#running-it-for-free).

## What the public site allows

Throughline v1 has no sign-in, so a public deployment sets `PUBLIC_DEPLOYMENT=true`. Then:

- Visitors can import, approve and reject only in **demo projects** (Acme Analytics). They cannot edit a proposal before approving it, so nobody can put their own wording on the public demo. The demo's agents run on a free model through OpenRouter when `OPENROUTER_API_KEY` is set, and on sample results otherwise or whenever that model fails. They never use your Anthropic key. The demo resets every night.
- **Every other project is view-only.** Its product view, technical view and review queue are public, but the forms are hidden and the server actions refuse changes.
- Repositories cannot be connected from the site.
- **Only the demo's jobs run, and only the demo's digest is sent.** Webhooks still store your own projects' pull requests and issues and queue their agent jobs, but the site leaves those jobs queued and sends no digest for those projects. That keeps the site safe to point at a private instance's database: the private instance runs those jobs and sends those digests.

You make changes to your own projects from a local copy of the app pointed at the production database (see [Working on your own projects](#working-on-your-own-projects)). Real sign-in is tracked in the "Teams and permissions" issue.

## 1. Create the database

1. In Neon, create a project. Any region close to your Vercel region works.
2. On the project dashboard, open **Connect**, turn on **Connection pooling**, and copy the connection string. It looks like `postgresql://user:password@ep-...-pooler.region.aws.neon.tech/neondb?sslmode=require`. The pooled string matters on Vercel, where every function instance opens its own connections. Turn pooling off and copy the direct string too; migrations need it.

With the [Neon CLI](https://neon.com/docs/cli/install) you can skip the copying: `neon link --project-id <id> --branch production` followed by `neon deploy` writes both strings to `.env.local` as `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct), and `neon.ts` declares the project's Neon services. The app then talks to Neon locally too, so the commands below need no `export`.

To work against local PGlite on a machine linked this way, blank both variables in the shell; a variable set in the shell, even to an empty string, wins over `.env.local`:

```bash
export DATABASE_URL="" DATABASE_URL_UNPOOLED=""
```

An empty `DATABASE_URL` alone is enough for `pnpm db:migrate`, which ignores `DATABASE_URL_UNPOOLED` unless `DATABASE_URL` is set too, but blanking both leaves nothing to get wrong. `pnpm test:e2e` blanks both for its own server, so it always uses its own PGlite database in `./.pglite-e2e`.

**Check the hostname's shape.** Neon's newer hostnames put the cell in its own label: `ep-...bdmohu8h-pooler.c-8.us-east-2.aws.neon.tech`. If every query fails with "Hostname/IP does not match certificate's altnames", the hostname is in a different shape, such as `ep-...bdmohu8h.c-8-pooler.us-east-2.aws.neon.tech`, which Neon's certificate does not cover; the `pg` driver since 8.16 verifies the hostname against it. Use the `-pooler.c-8.` form (the cell number is yours), whose certificate matches. The older form without a cell, `ep-...bdmohu8h-pooler.us-east-2.aws.neon.tech`, does not reach a cell-based endpoint at all, and Neon reports that as a password failure. Do not work around any of this with `uselibpqcompat` or `rejectUnauthorized: false`; those turn off certificate checks.

## 2. Create the tables and the demo

From your clone, run the migrations and the seed against Neon. `pnpm db:migrate` uses `DATABASE_URL_UNPOOLED` when it is set, because Neon's pooler runs in transaction mode and breaks the session state migrations rely on:

```bash
export DATABASE_URL='<the pooled connection string>'
export DATABASE_URL_UNPOOLED='<the direct connection string>'
pnpm db:migrate
pnpm db:seed
unset DATABASE_URL DATABASE_URL_UNPOOLED
```

Deploys do not migrate on their own, so a preview deployment can never change the production schema. Both databases therefore have to be migrated by hand, and the timing matters:

**Migrate before you merge.** Once the Vercel project is connected to the repository (section 3), every merge to `main` deploys to staging, and every push to `release` deploys to production, straight away. A change whose migration has not run fails as soon as it is live. So migrate each database one step ahead of the code:

- Before merging a pull request that adds a file under `src/db/migrations`, check out its branch and run `pnpm db:migrate` against the staging branch's connection strings, then merge.
- Before moving `release` forward to a commit with new migrations, run `pnpm db:migrate` against production from that commit, then push.

The code already live keeps working meanwhile, because it ignores the new columns and types.

**The production build checks this.** On a Vercel production build (`VERCEL_ENV=production` with `DATABASE_URL` set), `pnpm build` first runs `src/db/check-migrations.ts`. It reads the rows drizzle-kit writes to `drizzle.__drizzle_migrations` when it applies a migration and compares them with `src/db/migrations/meta/_journal.json` in the commit being built. If any migration is missing, the build stops before `next build` with a message naming the files:

```
Build stopped: the production database is missing 1 migration(s) this commit needs:
  src/db/migrations/0010_feedback.sql
The current production deployment keeps serving, and nothing was changed.
Run `pnpm db:migrate` against production (docs/DEPLOY.md, "Migrate before you merge"), then redeploy.
```

A failed build never goes live, so the previous deployment keeps serving. Run the migrations as above, then redeploy the failed deployment from the Vercel dashboard (or `vercel redeploy <deployment url>`). The check only reads; it never migrates, so deploys still cannot change the schema. If it cannot reach the database, the build fails too, with the connection error. If it still names a migration after `pnpm db:migrate` succeeded, that migration's journal timestamp is older than one production already has, so drizzle-kit skips it; delete it and its journal entry and generate it again with `pnpm db:generate`. Preview deployments, including staging, CI, local builds and builds without a database URL skip the check entirely, so a staging deployment with a missing migration builds and then fails at runtime.

This only holds for additive migrations: new tables, nullable columns, columns with defaults, new enum values. A change that renames or removes something takes two pull requests: first stop using the old name and let that deploy, then drop it. If a pull request is abandoned after its migration ran, its columns stay in production unused until a later migration removes them.

### A database branch per pull request

`.github/workflows/neon-branch.yml` gives every pull request its own Neon branch, a copy of production at the moment the PR opens. The workflow runs the PR's migrations on that branch and posts the schema diff as a PR comment, then deletes the branch when the PR closes. It needs two repository settings in GitHub under **Settings → Secrets and variables → Actions**:

- the variable `NEON_PROJECT_ID`, from the Neon project's **Settings** page
- the secret `NEON_API_KEY`, from **Account settings → API keys** in Neon

Or from the command line:

```bash
gh variable set NEON_PROJECT_ID --body '<project id>'
gh secret set NEON_API_KEY
```

Until both are set, the workflow fails on every pull request, so set them before merging it.

## 3. Create the Vercel project

1. In Vercel, choose **Add New → Project** and import the GitHub repository. Vercel detects Next.js and pnpm; keep the default build settings. Importing connects the project to the repository, so every push to the production branch deploys to production and every other branch and pull request gets a preview. A project created with `vercel deploy` from your machine is not connected: it keeps serving whatever was last uploaded, and merges never reach it. To check, open the project's **Settings → Git**. It should name this repository. If it does not, use **Connect Git Repository** there, or run `vercel git connect` from your clone, after migrating production to match the production branch (the connection deploys it from then on).

   In the project's settings, set the production branch to `release` (under **Environments → Production**), and create the branch with `git push origin main:release`. Merges to `main` then build as previews, which act as staging (see [Staging](#staging)), and production changes only when you push to `release`.

2. Before deploying, add these environment variables for **Production**:

| Variable             | Value                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`       | The pooled Neon connection string                                                                                  |
| `PUBLIC_DEPLOYMENT`  | `true`                                                                                                             |
| `CRON_SECRET`        | A random string, e.g. from `openssl rand -hex 32`. Vercel cron sends it; other callers of the cron routes get 401. |
| `ANTHROPIC_API_KEY`  | Optional. Used by the agents for your own projects, never for the demo.                                            |
| `OPENROUTER_API_KEY` | Optional. Lets the demo's agents answer with a real model. Point it at a free one (see below).                     |
| `OPENROUTER_MODEL`   | Optional. OpenRouter model ids, comma-separated in fallback order. Defaults to free models with tool calling.      |
| `GITHUB_*`           | Optional. The GitHub App settings from [`GITHUB_APP.md`](GITHUB_APP.md), to follow a real repository.              |

3. Deploy. Vercel registers the three cron jobs in `vercel.json`:
   - `/api/demo/reset` at 05:00 UTC rebuilds the Acme Analytics demo, undoing whatever visitors approved or rejected. It runs in one transaction, so visitors never see a half-built demo.
   - `/api/jobs/run` at 06:00 UTC runs any queued agent jobs that no webhook picked up.
   - `/api/digests/send` at 08:00 UTC on Mondays posts the weekly digest to Slack for each project that has one set up. Set it up from a local copy of the app pointed at this database, on the project's settings page; the public site does not offer it.

   Once a day is the most often the Hobby plan runs a cron.

### Staging

Every merge to `main` deploys to staging: a preview deployment with its own database and settings, which behaves the way the public site does. Its address is the branch alias, `https://<project>-git-main-<team>.vercel.app`, which always points at the newest `main` build. Like other previews, it sits behind Vercel sign-in unless you turn Deployment Protection off.

1. In Neon, create a branch named `staging` from `production`. Neon may offer an expiry date for a new branch; leave it off, or staging loses its database when the branch is deleted. Run `pnpm db:migrate` against it like production in section 2. It starts as a copy of production's data and drifts from there.
2. Add Preview environment variables scoped to the Git branch `main`, so pull request previews do not pick them up. Each command asks for the value:

   ```bash
   vercel env add DATABASE_URL preview main --sensitive        # the staging branch's pooled string
   vercel env add OPENROUTER_API_KEY preview main --sensitive
   vercel env add OPENROUTER_MODEL preview main
   openssl rand -hex 32 | tr -d '\n' | vercel env add CRON_SECRET preview main --sensitive
   printf 'true' | vercel env add PUBLIC_DEPLOYMENT preview main
   ```

   Use a different `CRON_SECRET` from production's, so a leak in one does not open the other.

3. Push to `main`, or redeploy its latest deployment, to pick up the variables.

Vercel runs cron jobs only on production, so staging's demo does not reset nightly and its queued agent jobs run only when a webhook starts them. To reset the demo by hand, call the reset route with the staging `CRON_SECRET`, as in section 4.

To release, fast-forward `release` to the `main` commit you checked on staging, after migrating production if it adds migrations:

```bash
git push origin <commit>:release
```

## 4. Check it

1. Open the deployment's URL in a private browser window. **Open demo** should go straight to the Acme Analytics product view with no sign-in.
2. In the demo's review queue, approve a proposal. It should apply and leave the queue.
3. Confirm the reset route refuses strangers and works for the cron:

   ```bash
   curl -i https://<your-host>/api/demo/reset                                    # 401
   curl -i -H "Authorization: Bearer <CRON_SECRET>" https://<your-host>/api/demo/reset   # 200 {"projectId": ...}
   ```

   The approved proposal is back in the queue.

4. Merge a pull request, or push to `main`. A Vercel preview deployment should appear on that commit in GitHub, and staging should serve the new code within a few minutes. Push that commit to `release`, and production should follow. If nothing appears, the project is not connected to the repository; see section 3.

If you set up the GitHub App, set its webhook URL to `https://<your-host>/api/github/webhook`.

## Running it for free

The whole public site can run at no cost:

- **Vercel Hobby** hosts the app, with one cron run a day. It is for non-commercial use.
- **Neon Free** holds the database. It pauses after a few minutes without traffic and wakes on the next request, so the first page load after a quiet spell takes a few seconds.
- **OpenRouter free models** power the demo's agents. OpenRouter lists models with a `:free` suffix that cost nothing per token. At the time of writing, the free tier allows about 20 requests a minute and 50 a day, or 1,000 a day once the account has ever bought $10 of credit. Check [OpenRouter's limits page](https://openrouter.ai/docs/api-reference/limits) for the current numbers. When the limit is hit, the demo falls back to sample results, so visitors see a proposal either way.

To pick a free model, list the ones that support tool calling:

```bash
curl -s https://openrouter.ai/api/v1/models | jq -r '
  .data[] | select(.id | endswith(":free"))
  | select(.supported_parameters | index("tools")) | .id'
```

Set `OPENROUTER_MODEL` to a comma-separated list of them in the order to try, for example:

```
OPENROUTER_MODEL=nvidia/nemotron-3.5-super-vl:free,liquid/lfm-2.5-2.6b:free
```

Throughline sends the list as OpenRouter's [`models` fallback parameter](https://openrouter.ai/docs/guides/routing/model-fallbacks): the first model is tried first, and when it is rate-limited, down or rejects the request, OpenRouter tries the next one. Billing follows the model that answers, so keep every entry a `:free` model. Leave the variable unset for the default list in `src/adapters/llm/openrouter.ts`. Free models come and go; if every listed model disappears, imports on the demo fall back to sample results and the server log shows the OpenRouter error. Larger models give better reconciliation results; a very small one may fail validation more often, which also falls back to a sample result, so put the largest first.

To set the key and models on Vercel from the command line:

```bash
printf '%s' 'sk-or-v1-...' | vercel env add OPENROUTER_API_KEY production
printf '%s' 'nvidia/nemotron-3.5-super-vl:free,liquid/lfm-2.5-2.6b:free' | vercel env add OPENROUTER_MODEL production
vercel redeploy --prod   # environment changes apply on the next deployment
```

Your own projects use `ANTHROPIC_API_KEY` when it is set, and otherwise the same OpenRouter model. A free model is fine for trying the tool on a real repository; for a roadmap you rely on, use Claude.

## Working on your own projects

On the public site your projects are view-only, so you change them from your machine against the production database:

1. Copy the production settings into `.env.local`, for example with the Vercel CLI: `vercel env pull .env.local --environment=production`.
2. Delete the `PUBLIC_DEPLOYMENT` line from `.env.local`. Keep the Anthropic, OpenRouter and GitHub settings: your projects' agent jobs run on your machine with these settings.
3. Run `pnpm dev`. Everything you do at http://localhost:3000 now changes production data, so take care.

The public site does not run your projects' jobs, so a merged pull request's reconciliation waits in the queue until your copy runs it. Whenever an action on your copy queues a job (approving a proposal, moving a target, connecting a repository), it also runs every due job. To run them without doing any of those:

```bash
curl -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3000/api/jobs/run   # leave out the header if CRON_SECRET is empty in .env.local
```

The public site's weekly cron does not send your projects' digests either. For a roadmap that should reconcile on its own and send a weekly digest, use [a private instance](#a-private-instance-on-your-own-key).

To create a project, run this in Neon's **SQL Editor** (there is no create-project page in v1):

```sql
insert into projects (name, slug) values ('Throughline', 'throughline');
```

The project is then at `https://<your-host>/p/throughline`.

## A private instance on your own key

The public site is built for strangers: its agents never spend your Anthropic key, and anything outside the demo is view-only. For a roadmap you rely on, run a second instance of the same code that is private to you, with its own database and your own model key. The two instances share a repository, so a fix made for one reaches the other on the next release.

1. **A second database.** Create a new Neon project (for example `throughline-private`) rather than a branch of the public one, so a mistake on either side cannot touch the other. Migrate it as in section 2.

   If `pnpm db:migrate` cannot reach Neon from where you are running it (some sandboxes allow only HTTP traffic), apply the migrations by hand: run each file under `src/db/migrations/` in order, then record them so the production build check passes. The check reads `drizzle.__drizzle_migrations`, matching each row's `created_at` to the `when` field in `meta/_journal.json`:

   ```sql
   create schema if not exists drizzle;
   create table if not exists drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint);
   -- one row per migration: hash is the SHA-256 of the .sql file, created_at is its journal "when"
   insert into drizzle.__drizzle_migrations (hash, created_at) values ('<sha256>', 1793730616788);
   ```

2. **A second Vercel project** importing the same GitHub repository (Vercel allows several projects per repository). Set its production branch to `release` as in section 3, or to `main` if this instance does not need staging.

3. **Environment variables**, for Production:

   | Variable            | Value                                                                                                                                      |
   | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
   | `DATABASE_URL`      | The new database's pooled connection string                                                                                                |
   | `ANTHROPIC_API_KEY` | Your key. Every project on this instance uses it.                                                                                          |
   | `ANTHROPIC_MODEL`   | Optional. Defaults to `claude-sonnet-5-5`; set `claude-opus-5-5` for the most careful reconciliation.                                      |
   | `CRON_SECRET`       | A fresh random string, different from the public site's                                                                                    |
   | `GITHUB_*`          | A GitHub App for this instance (see step 5), with `GITHUB_ALLOWED_OWNERS` set to your account                                              |
   | `PUBLIC_DEPLOYMENT` | **Leave unset.** This is what makes the instance private: forms work on every project, and agents use `ANTHROPIC_API_KEY` for all of them. |

   Do not set `OPENROUTER_API_KEY` here unless you want a free model as a fallback; with the Anthropic key set, your projects never use it.

4. **Lock the door.** With `PUBLIC_DEPLOYMENT` unset, anyone who finds the URL can approve proposals, connect repositories and spend your key. In the project's **Settings → Deployment Protection**, turn on **Vercel Authentication** and set its scope to **All Deployments**. The default scope, Standard Protection, leaves production domains public, which is exactly the URL you need to close. Every page then requires your Vercel sign-in. That is the stand-in for real sign-in until the "Teams and permissions" issue is built.

   Vercel's documentation does not say whether its own cron requests pass Deployment Protection, so check once protection is on: run `vercel crons run /api/jobs/run` and confirm in the Cron Jobs tab's **View Logs** that it returned 200. No log entry, or a 401, means it did not get through. If the cron is blocked, merged pull requests still reconcile, because the webhook runs queued jobs straight away; only the daily catch-up sweep and the weekly digest email stop.

5. **A GitHub App of its own.** A GitHub App has one webhook URL, so the public site's app cannot also deliver to this instance. GitHub cannot sign in to Vercel, so its deliveries need a bypass: in **Deployment Protection**, turn on **Protection Bypass for Automation** and copy the secret. Then register a second app following [`GITHUB_APP.md`](GITHUB_APP.md), with its webhook URL set to `https://<private-host>/api/github/webhook?x-vercel-protection-bypass=<secret>`, and install it on the repositories this instance will follow. The secret only lets a request past Deployment Protection; the webhook route still rejects any delivery not signed with the app's webhook secret. Without it, every delivery gets a 401 and nothing reconciles; the app's **Advanced → Recent Deliveries** page shows the status.

6. **Create your project** with the SQL in the previous section, then import a roadmap and connect a repository from the deployed site itself; since the instance is private, there is no need to work from a local copy.

7. **Optional: agents over MCP.** Set `MCP_TOKEN` to a fresh random string to turn on `/api/mcp`, so coding agents can read requirements and propose pull request links for you to approve (see "MCP server" in [`ARCHITECTURE.md`](ARCHITECTURE.md)). An agent needs both the token and the bypass secret from step 5, since Deployment Protection stops it first. The bypass secret opens the whole instance, not just `/api/mcp`: whoever holds it can open the review queue and approve proposals. Give it only to sessions you supervise, not to unattended agents. In Claude Code:

   ```bash
   claude mcp add --transport http throughline "https://<private-host>/api/mcp" \
     --header "Authorization: Bearer <MCP_TOKEN>" \
     --header "x-vercel-protection-bypass: <secret>"
   ```

What this instance costs: Vercel Hobby and Neon Free are enough; the Anthropic key is billed per reconciliation, roughly one agent call per merged pull request that references a requirement, plus one per suggested link. Vercel Authentication on All Deployments and Protection Bypass for Automation are both free on Hobby.

### Example: the factory-platform roadmap

Throughline's second use of itself is tracking the [factory-platform](https://github.com/JakobKrzyston/factory-platform) project, a software factory built in the open. That roadmap lives on a private instance set up exactly as above, with a `factory` project seeded from the repository's `docs/PLAN.md` as a single approved import proposal. Its pull requests reference requirements with `Implements TL-n` and are reconciled on merge, and the factory's own agents read their requirement and propose their pull request's link through the MCP server (step 7).

## A view-only mirror of a private instance

A private instance is closed to everyone but you, and anything that gets a visitor past Deployment Protection (the bypass secret, a Vercel share link) opens all of it: the review queue, import and your model key. To send someone a read-only link to a private roadmap, run a third Vercel project on the private instance's database in public mode. Every non-demo project is then view-only (see [What the public site allows](#what-the-public-site-allows)), and the mirror leaves those projects' jobs and digests to the private instance.

1. **A Vercel project** importing the same repository, building `release` like the private instance, so both run the same code against the same schema.
2. **Environment variables**, for Production only:

   | Variable                | Value                                                              |
   | ----------------------- | ------------------------------------------------------------------ |
   | `DATABASE_URL`          | The private instance's pooled connection string                    |
   | `DATABASE_URL_UNPOOLED` | Its direct connection string (used by the build's migration check) |
   | `PUBLIC_DEPLOYMENT`     | `true`                                                             |

   **Leave everything else unset:** no `ANTHROPIC_API_KEY` or `OPENROUTER_API_KEY`, no `CRON_SECRET`, no `MCP_TOKEN`, no `GITHUB_*` or `LINEAR_*`, no Slack webhook. Each missing setting closes a door: without `CRON_SECRET` the demo reset and digest routes refuse every request, `/api/mcp` is off on any public deployment, and without webhook secrets the webhook routes refuse every delivery.

3. **Deployment Protection off**, so the link opens without a Vercel sign-in.
4. **Webhooks stay where they are.** GitHub and Linear keep delivering to the private instance, which reconciles and runs the jobs; the mirror only reads the result.
5. **Deploy it whenever the private instance moves to a new release.** It has no migrations of its own: once the private database is migrated, both builds pass the check.

The database may also hold the Acme Analytics demo, which visitors to the mirror can change as on any public site. With no `CRON_SECRET` it is never reset there. That does not touch your own projects.

**Check it from a signed-out client** (`curl` or a private window):

```bash
M=https://<mirror-host>
curl -s -o /dev/null -w '%{http_code}\n' $M/p/<slug>                              # 200: the product view
for p in review plan import; do curl -s $M/p/<slug>/$p | grep -c '<form'; done   # 0 each: no forms
curl -s -X POST $M/api/jobs/run        # {"done":0,...} unless a demo job is queued
curl -s -X POST $M/api/digests/send    # 401
curl -s -X POST $M/api/demo/reset      # 401
curl -s -X POST $M/api/mcp             # 503
curl -s -X POST $M/api/github/webhook  # 503
```

The review, plan and import pages each say the project is view-only. Then compare the private project's job and event counts before and after a day of the mirror running: only the private instance should have added to them.

The factory-platform roadmap is mirrored this way: its `factory` project is readable on the mirror without a sign-in, while the private instance stays behind Vercel Authentication.

## Dogfooding: Throughline tracking its own roadmap

Throughline's own roadmap, [`docs/PLAN.md`](PLAN.md), lives in the `throughline` project on the public site, connected to this repository. To set it up, with the local app from the previous section running:

1. **Create the project** with the SQL above.
2. **Import the plan.** Open http://localhost:3000/p/throughline/import, paste the stages from `docs/PLAN.md` (stage 1 to stage 7, without the "Future work" list), and generate a proposal. Approve it in the review queue, editing anything the import got wrong. Each stage becomes an outcome with its requirements, keyed `TL-1`, `TL-2` and so on.
3. **Connect the repository.** Install the GitHub App on the repository, then connect it at http://localhost:3000/p/throughline/settings. Throughline imports its open issues and the pull requests merged in the last 90 days.
4. **Link the work that already shipped.** The import skips reconciliation for work that finished before Throughline was watching. To link it, edit the description of each stage's merged pull request on GitHub and add a line naming the requirements it delivered, e.g. `Implements TL-1, TL-2, TL-3`. GitHub sends an `edited` webhook to the public site, which links the pull request and asks the reconciliation agent whether the requirements are done.
5. **Approve the results.** The agent's proposals appear in http://localhost:3000/p/throughline/review. Approve them.

From then on, a pull request whose description says `Implements TL-n` is linked and reconciled as soon as it merges, and the public product view at `/p/throughline` shows each stage's state.
