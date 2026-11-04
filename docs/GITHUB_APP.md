# Setting up the GitHub App

Throughline reads issues and pull requests through a GitHub App. The app is optional: without it the app runs on demo data, and the settings page explains that GitHub is not set up.

## 1. Create the app

Go to **GitHub → Settings → Developer settings → GitHub Apps → New GitHub App** (or the same path under an organisation's settings).

| Field                      | Value                                                                |
| -------------------------- | -------------------------------------------------------------------- |
| GitHub App name            | Anything, e.g. `Throughline (yourname)`. Its URL slug is used below. |
| Homepage URL               | Your deployment's URL                                                |
| Callback URL               | Leave empty. Throughline does not sign users in with GitHub.         |
| Webhook → Active           | Checked                                                              |
| Webhook URL                | `https://<your-host>/api/github/webhook`                             |
| Webhook secret             | A long random string, e.g. from `openssl rand -hex 32`               |
| Where can it be installed? | "Only on this account"                                               |

### Repository permissions

All read-only. Leave every other permission at "No access".

| Permission    | Access    | Why                                                                  |
| ------------- | --------- | -------------------------------------------------------------------- |
| Issues        | Read-only | Backfill open issues and receive `issues` events                     |
| Pull requests | Read-only | Backfill merged PRs and receive `pull_request` events                |
| Contents      | Read-only | The reconciliation agent reads changed files and diffs of merged PRs |
| Metadata      | Read-only | Required by GitHub for every app; used to look up a repository's id  |

### Subscribe to events

- **Issues**
- **Pull request**

Other events are acknowledged and ignored.

## 2. Collect the credentials

After creating the app:

1. Note the **App ID** at the top of the app's page.
2. Under **Private keys**, click **Generate a private key**. A `.pem` file downloads.
3. Note the app's **slug**: the last part of its public URL, `https://github.com/apps/<slug>`.

Set these environment variables (in `.env.local` locally, or in the Vercel project settings):

```bash
GITHUB_APP_ID=123456
GITHUB_APP_SLUG=throughline-yourname
# Accounts whose repositories may be connected, comma-separated.
GITHUB_ALLOWED_OWNERS=yourname
GITHUB_WEBHOOK_SECRET=<the webhook secret from step 1>
# The whole .pem file. On one line, write each line break as \n.
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----\n"
```

Throughline has no sign-in yet, so anyone who can open a project's settings page can connect a repository. `GITHUB_ALLOWED_OWNERS` limits that to repositories owned by the accounts you list, and repositories cannot be connected until it is set. On a public site, set `PUBLIC_DEPLOYMENT=true` as well, and nobody can connect repositories from the site at all (see [`DEPLOY.md`](DEPLOY.md)).

On Vercel, also set `CRON_SECRET` to a random string. Vercel's cron then sends it to `/api/jobs/run`, and other callers are refused.

## 3. Connect a repository

1. Install the app on the repository: `https://github.com/apps/<slug>/installations/new`.
2. Open `/p/<project-slug>/settings` and enter the repository as `owner/name`.

Throughline then imports the repository's open issues and the pull requests merged in the last 90 days. From then on, webhooks keep work items up to date.

A pull request or issue whose title or description says `Implements TL-12` or `Part of TL-12` is linked to requirement `TL-12` automatically. Several references are fine (`Part of TL-3, TL-4 and TL-5`), keys are not case-sensitive, and keys that do not exist in the project are ignored.

## Receiving webhooks locally

GitHub cannot reach `localhost`, so forward deliveries with [smee.io](https://smee.io):

1. Open https://smee.io and click **Start a new channel**.
2. Set the app's webhook URL to the channel URL while you develop.
3. Run the forwarder next to `pnpm dev`:

   ```bash
   npx smee-client --url https://smee.io/<channel> --target http://localhost:3000/api/github/webhook
   ```

The app's **Advanced** tab lists recent deliveries and can redeliver one, which is a quick way to check that replays create no duplicates.
