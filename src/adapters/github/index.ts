/** Builds the GitHub adapter from environment variables. Exports isGitHubConfigured, getGitHubAdapter, githubInstallUrl. */
import { App } from "octokit";

import { GitHubAdapter } from "./adapter";

/**
 * Whether GitHub App credentials are set, so repositories can be connected.
 *
 * Returns:
 *   True when GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are both set.
 */
export function isGitHubConfigured(): boolean {
  return Boolean(
    process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY,
  );
}

/**
 * Return a GitHub adapter authenticated as the GitHub App.
 *
 * Returns:
 *   The adapter.
 *
 * Raises:
 *   Error: GitHub App credentials are not set.
 */
export function getGitHubAdapter(): GitHubAdapter {
  const { GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY } = process.env;
  if (!GITHUB_APP_ID || !GITHUB_APP_PRIVATE_KEY) {
    throw new Error(
      "GitHub is not set up: set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY (see docs/GITHUB_APP.md)",
    );
  }
  return new GitHubAdapter(
    new App({
      appId: GITHUB_APP_ID,
      // Hosting dashboards often store the PEM on one line with literal "\n" sequences.
      privateKey: GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  );
}

/**
 * The page where someone installs the GitHub App on their repositories.
 *
 * Returns:
 *   The install URL, or null when GITHUB_APP_SLUG is not set.
 */
export function githubInstallUrl(): string | null {
  const slug = process.env.GITHUB_APP_SLUG;
  return slug ? `https://github.com/apps/${slug}/installations/new` : null;
}
