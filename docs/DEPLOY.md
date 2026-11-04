# Deploying Throughline

This guide puts Throughline on Vercel with a Neon Postgres database, as a public site anyone can open without signing in. It takes about 20 minutes. You need accounts on [Vercel](https://vercel.com), [Neon](https://neon.tech) and GitHub, and a local clone that runs (see the README).

## What the public site allows

Throughline v1 has no sign-in, so a public deployment sets `PUBLIC_DEPLOYMENT=true`. Then:

- Visitors can import, approve and reject only in **demo projects** (Acme Analytics). Demo agents return sample results, so visitors never spend your Anthropic key. The demo resets every night.
- **Every other project is view-only.** Its product view, technical view and review queue are public, but the forms are hidden and the server actions refuse changes.
- Repositories cannot be connected from the site.

You make changes to your own projects from a local copy of the app pointed at the production database (see [Working on your own projects](#working-on-your-own-projects)). Real sign-in is tracked in the "Teams and permissions" issue.

## 1. Create the database

1. In Neon, create a project. Any region close to your Vercel region works.
2. On the project dashboard, open **Connect**, turn on **Connection pooling**, and copy the connection string. It looks like `postgresql://user:password@ep-...-pooler.region.aws.neon.tech/neondb?sslmode=require`. The pooled string matters on Vercel, where every function instance opens its own connections.

## 2. Create the tables and the demo

From your clone, run the migrations and the seed against Neon:

```bash
export DATABASE_URL='<the connection string>'
pnpm db:migrate
pnpm db:seed
unset DATABASE_URL
```

Run `pnpm db:migrate` the same way before deploying any change that adds a migration under `src/db/migrations`. Deploys do not migrate on their own, so a preview deployment can never change the production schema.

## 3. Create the Vercel project

1. In Vercel, choose **Add New → Project** and import the GitHub repository. Vercel detects Next.js and pnpm; keep the default build settings.
2. Before deploying, add these environment variables for **Production**:

| Variable            | Value                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`      | The Neon connection string                                                                                         |
| `PUBLIC_DEPLOYMENT` | `true`                                                                                                             |
| `CRON_SECRET`       | A random string, e.g. from `openssl rand -hex 32`. Vercel cron sends it; other callers of the cron routes get 401. |
| `ANTHROPIC_API_KEY` | Optional. Used by the agents for your own projects. Without it they return sample results.                         |
| `GITHUB_*`          | Optional. The GitHub App settings from [`GITHUB_APP.md`](GITHUB_APP.md), to follow a real repository.              |

3. Deploy. Vercel registers the two cron jobs in `vercel.json`:
   - `/api/demo/reset` at 05:00 UTC rebuilds the Acme Analytics demo, undoing whatever visitors approved or rejected. It runs in one transaction, so visitors never see a half-built demo.
   - `/api/jobs/run` at 06:00 UTC runs any queued agent jobs that no webhook picked up.

   Once a day is the most often the Hobby plan runs a cron.

## 4. Check it

1. Open the deployment's URL in a private browser window. **Open demo** should go straight to the Acme Analytics product view with no sign-in.
2. In the demo's review queue, approve a proposal. It should apply and leave the queue.
3. Confirm the reset route refuses strangers and works for the cron:

   ```bash
   curl -i https://<your-host>/api/demo/reset                                    # 401
   curl -i -H "Authorization: Bearer <CRON_SECRET>" https://<your-host>/api/demo/reset   # 200 {"projectId": ...}
   ```

   The approved proposal is back in the queue.

If you set up the GitHub App, set its webhook URL to `https://<your-host>/api/github/webhook`.

## Working on your own projects

On the public site your projects are view-only, so you change them from your machine against the production database:

1. Copy the production settings into `.env.local`, for example with the Vercel CLI: `vercel env pull .env.local --environment=production`.
2. Delete the `PUBLIC_DEPLOYMENT` line from `.env.local`. Keep the Anthropic and GitHub settings: approving a proposal can start agent jobs, and they run on your machine with these settings.
3. Run `pnpm dev`. Everything you do at http://localhost:3000 now changes production data, so take care.

To create a project, run this in Neon's **SQL Editor** (there is no create-project page in v1):

```sql
insert into projects (name, slug) values ('Throughline', 'throughline');
```

The project is then at `https://<your-host>/p/throughline`.

## Dogfooding: Throughline tracking its own roadmap

Throughline's own roadmap, [`docs/PLAN.md`](PLAN.md), lives in the `throughline` project on the public site, connected to this repository. To set it up, with the local app from the previous section running:

1. **Create the project** with the SQL above.
2. **Import the plan.** Open http://localhost:3000/p/throughline/import, paste the stages from `docs/PLAN.md` (stage 1 to stage 7, without the "Future work" list), and generate a proposal. Approve it in the review queue, editing anything the import got wrong. Each stage becomes an outcome with its requirements, keyed `TL-1`, `TL-2` and so on.
3. **Connect the repository.** Install the GitHub App on the repository, then connect it at http://localhost:3000/p/throughline/settings. Throughline imports its open issues and the pull requests merged in the last 90 days.
4. **Link the work that already shipped.** The import skips reconciliation for work that finished before Throughline was watching. To link it, edit the description of each stage's merged pull request on GitHub and add a line naming the requirements it delivered, e.g. `Implements TL-1, TL-2, TL-3`. GitHub sends an `edited` webhook to the public site, which links the pull request and asks the reconciliation agent whether the requirements are done.
5. **Approve the results.** The agent's proposals appear in http://localhost:3000/p/throughline/review. Approve them.

From then on, a pull request whose description says `Implements TL-n` is linked and reconciled as soon as it merges, and the public product view at `/p/throughline` shows each stage's state.
