/** Builds the GitHub adapter from environment variables. Exports missingGitHubSettings, isGitHubConfigured, isOwnerAllowed, getGitHubAdapter, githubInstallUrl. */
import { App } from "octokit";

import { GitHubAdapter } from "./adapter";

/**
 * The environment variables GitHub needs before repositories can be connected, that are unset.
 *
 * GITHUB_ALLOWED_OWNERS is required as well as the credentials: v1 has no sign-in, so without it
 * anyone who can open the settings page could import any repository the app can see.
 *
 * Returns:
 *   The names of the unset variables, empty when GitHub is fully set up.
 */
export function missingGitHubSettings(): string[] {
  const required = {
    GITHUB_APP_ID: process.env.GITHUB_APP_ID,
    GITHUB_APP_PRIVATE_KEY: process.env.GITHUB_APP_PRIVATE_KEY,
    GITHUB_ALLOWED_OWNERS: process.env.GITHUB_ALLOWED_OWNERS?.trim(),
  };
  return Object.entries(required)
    .filter(([, value]) => !value)
    .map(([name]) => name);
}

/**
 * Whether GitHub is set up well enough for repositories to be connected.
 *
 * Returns:
 *   True when no required variable is missing (see missingGitHubSettings).
 */
export function isGitHubConfigured(): boolean {
  return missingGitHubSettings().length === 0;
}

/**
 * Whether a repository's owner is listed in GITHUB_ALLOWED_OWNERS.
 *
 * Args:
 *   fullName: `owner/name`.
 *
 * Returns:
 *   True when the owner is listed. GitHub names are not case-sensitive, so neither is this.
 */
export function isOwnerAllowed(fullName: string): boolean {
  const owner = fullName.split("/")[0].toLowerCase();
  const allowed = (process.env.GITHUB_ALLOWED_OWNERS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase());
  return owner !== "" && allowed.includes(owner);
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
