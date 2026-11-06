/** Reads comma-separated allowlists from environment variables, such as GITHUB_ALLOWED_OWNERS. Exports isListed. */

/**
 * Whether a name is in a comma-separated list, ignoring case and spaces around entries.
 *
 * Args:
 *   list: The list as the environment variable holds it, or undefined when it is unset.
 *   name: The name to look for.
 *
 * Returns:
 *   True when the name is not empty and is listed.
 */
export function isListed(list: string | undefined, name: string): boolean {
  const wanted = name.trim().toLowerCase();
  const entries = (list ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase());
  return wanted !== "" && entries.includes(wanted);
}
