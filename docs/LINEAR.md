# Importing a roadmap from Linear

"Import from Linear" on a project's import page reads one Linear team and drafts its roadmap as a proposal for the review queue: each initiative becomes an outcome, and its projects become requirements with their target dates. Projects in no initiative become outcomes of their own. Completed and canceled projects are left out. Nothing changes until someone approves the proposal.

Linear is optional. Without a key, and always for demo projects, the import reads a sample workspace so you can try it.

## 1. Create an API key

In Linear, open **Settings → Security & access → Personal API keys** and create a key. If Linear asks which access the key gets, read access is enough: Throughline lists teams and reads projects and initiatives, and never writes to Linear. The key can read whatever its owner can, so create it from an account that can see the teams you want to import.

## 2. Set it

Add the key to `.env.local` (or your host's environment variables) and restart the app:

```bash
LINEAR_API_KEY=lin_api_...
```

The key applies to the whole server, the same way the GitHub App credentials do. Per-project connections are not built yet.

## 3. Import

Open `/p/<project>/import`, click **Choose a Linear team** under **Import from Linear**, pick a team, and click **Import from Linear**. Before you approve, reword outcomes for customers where the initiative's name is internal shorthand, and mark which requirements customers can see. Linear does not record that, so the import marks none of them. A project shared with other teams appears in each of their imports; the proposal says which, so approve it once.

If Linear rejects the key, limits requests or cannot be reached, the page says so and nothing is saved.
