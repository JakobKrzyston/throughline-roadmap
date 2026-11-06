# Linear

Throughline reads Linear in two ways: it can import a team's roadmap, and it can track a team's issues as work items. Both use one server-wide API key, and Throughline only ever reads from Linear.

## Importing a roadmap

"Import from Linear" on a project's import page reads one Linear team and drafts its roadmap as a proposal for the review queue: each initiative becomes an outcome, and its projects become requirements with their target dates. Projects in no initiative become outcomes of their own. Completed and canceled projects are left out. Nothing changes until someone approves the proposal.

Linear is optional. Without a key, and always for demo projects, the import reads a sample workspace so you can try it.

### 1. Create an API key

In Linear, open **Settings → Security & access → Personal API keys** and create a key. If Linear asks which access the key gets, read access is enough: Throughline lists teams and reads projects, initiatives and issues, and never writes to Linear. The key can read whatever its owner can, so create it from an account that can see the teams you want to import.

### 2. Set it

Add the key to `.env.local` (or your host's environment variables) and restart the app:

```bash
LINEAR_API_KEY=lin_api_...
```

The key applies to the whole server, the same way the GitHub App credentials do. Per-project connections are not built yet.

### 3. Import

Open `/p/<project>/import`, click **Choose a Linear team** under **Import from Linear**, pick a team, and click **Import from Linear**. Before you approve, reword outcomes for customers where the initiative's name is internal shorthand, and mark which requirements customers can see. Linear does not record that, so the import marks none of them. A project shared with other teams appears in each of their imports; the proposal says which, so approve it once.

If Linear rejects the key, limits requests or cannot be reached, the page says so and nothing is saved.

## Tracking issues as work items

Connect a Linear team to a project and its issues are tracked like GitHub's issues and pull requests:

- An issue that says "Implements TL-12" or "Part of TL-12" in its title or description is linked to that requirement.
- Moving a linked issue to a started state, such as In Progress, marks a planned requirement in progress.
- Completing a linked issue queues a check of the roadmap against the work, the same as a merged pull request. A canceled or duplicate issue does not.
- An issue completed inside a Linear project with no reference gets a suggested link on `/review`. Issues outside any project, which are mostly bugs and chores, are tracked but get no suggestion.

A workspace with a team keyed `TL` is a special case: that team's issue ids (`TL-5`) look like requirement keys, so in any team's issue Throughline cannot tell "Part of TL-12" apart from a mention of the TL team's issue. When a team is connected, Throughline checks whether the workspace has a `TL` team. If it does, references in Linear issues are ignored, links come from suggestions only, and the settings page says so. The check is made when the team is connected, so a `TL` team created later is not noticed.

An issue moved to another team keeps updating in every project that already tracks it, even if its new team is not connected.

Demo projects connect a sample team, `ENG`, and never call Linear.

### 1. Set the API key and the allowed teams

Set `LINEAR_API_KEY` as in "Importing a roadmap" above. Create the key from an account that can see the teams you want to connect.

Throughline has no sign-in yet, so anyone who can open a project's settings page could connect any team the key can see. `LINEAR_ALLOWED_TEAMS` limits that to the teams you list by key, and real teams cannot be connected until it is set, like `GITHUB_ALLOWED_OWNERS` for repositories:

```bash
LINEAR_ALLOWED_TEAMS=ENG,MOBILE
```

### 2. Connect the team

Open `/p/<project>/settings` and, under **Linear teams**, enter the team's key: the letters before the number in its issue ids, such as `ENG`. Throughline imports the team's open issues and the issues completed in the last 90 days. Work that finished before the team was connected is linked but not reconciled, so the review queue is not flooded with history.

### 3. Add a webhook

So Throughline hears about changes as they happen:

1. In Linear, open **Settings → API → Webhooks** (workspace admins only) and create a webhook.
2. Set the URL to `https://<your-host>/api/linear/webhook`.
3. Choose the teams to send (or all public teams), and tick **Issues** under data change events. Nothing else is needed.
4. Copy the webhook's signing secret into the environment and restart the app:

```bash
LINEAR_WEBHOOK_SECRET=lin_wh_...
```

Throughline checks each delivery's `Linear-Signature` against the secret, and its `webhookTimestamp`, as Linear recommends: a delivery that is not signed correctly, or was sent more than a minute ago, is rejected with 401. Deliveries for issues of teams that are not connected are ignored, unless the issue is already tracked. Otherwise Throughline reads the issue from Linear again, so a delivery that is retried only syncs the issue as it is now.

To try the webhook locally, expose the dev server with a tunnel (for example `cloudflared tunnel --url http://localhost:3000`) and use the tunnel's URL in step 2.
