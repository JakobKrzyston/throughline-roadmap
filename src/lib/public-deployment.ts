/** Rules for a public deployment with no sign-in (PUBLIC_DEPLOYMENT=true). Exports isPublicDeployment, isViewOnly. */

/**
 * Whether this server is open to the public with no sign-in.
 *
 * Then visitors may change only demo projects, demo agents use sample results instead of the AI
 * key, and repositories are connected by the owner from a local copy of the app.
 *
 * Returns:
 *   True when PUBLIC_DEPLOYMENT is "true".
 */
export function isPublicDeployment(): boolean {
  return process.env.PUBLIC_DEPLOYMENT === "true";
}

/**
 * Whether visitors may look at a project but not change it.
 *
 * Args:
 *   project: The project's demo flag.
 *
 * Returns:
 *   True for a project that is not a demo on a public deployment.
 */
export function isViewOnly(project: { isDemo: boolean }): boolean {
  return isPublicDeployment() && !project.isDemo;
}
