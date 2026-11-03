/** Builds the size-limited work item context agents send to the model. Exports summariseChanges, describeChanges, dataBlock and the size limits. */
import { and, eq } from "drizzle-orm";

import type { SourceAdapter, SourceChangedFile } from "@/adapters/source";
import type { Database } from "@/db/client";
import { repositories, type workItems } from "@/db/schema";

/** Most files listed one by one; the rest are counted in one line. */
export const MAX_LISTED_FILES = 100;
/** Most characters of diff sent in total. */
export const MAX_DIFF_CHARS = 20_000;
/** Most characters of diff sent for any one file, so one huge file cannot crowd out the rest. */
export const MAX_FILE_DIFF_CHARS = 4_000;

// Generated files whose diffs say nothing about what was built.
const LOCKFILES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "Cargo.lock",
  "Gemfile.lock",
  "poetry.lock",
  "go.sum",
]);

type WorkItem = typeof workItems.$inferSelect;

/**
 * Summarise a pull request's changes: totals, a file list and as much diff as fits the limits.
 *
 * Args:
 *   files: The changed files, in the source's order.
 *
 * Returns:
 *   Plain text for the prompt, never longer than about MAX_DIFF_CHARS plus the file list.
 */
export function summariseChanges(files: SourceChangedFile[]): string {
  if (files.length === 0) return "No files changed.";

  const total = lineCounts(files);
  const listed = files.slice(0, MAX_LISTED_FILES);
  const rest = files.slice(MAX_LISTED_FILES);
  const lines = [
    `${count(files.length, "file")} changed ${total}.`,
    "",
    "Files:",
    ...listed.map(
      (file) => `- ${file.status} ${file.path} ${lineCounts([file])}`,
    ),
  ];
  if (rest.length > 0) {
    lines.push(`- …and ${count(rest.length, "more file")} ${lineCounts(rest)}`);
  }

  const diffs: string[] = [];
  let budget = MAX_DIFF_CHARS;
  let left = 0;
  for (const file of files) {
    if (file.patch === null || LOCKFILES.has(basename(file.path))) continue;
    const patch = truncate(file.patch, Math.min(MAX_FILE_DIFF_CHARS, budget));
    if (patch === null) {
      left++;
      continue;
    }
    diffs.push(`--- ${file.path}\n${patch}`);
    budget -= patch.length;
  }
  if (diffs.length > 0) {
    lines.push(
      "",
      left > 0
        ? `Diff (cut to fit; ${count(left, "more file")} left out):`
        : "Diff (long files cut to fit):",
      ...diffs,
    );
  }
  return lines.join("\n");
}

/**
 * Describe what a work item changed, fetching a pull request's files from its source.
 *
 * Args:
 *   db: Database holding the project's connected repositories.
 *   source: Where to read the files, or null when no source is set up (demo mode).
 *   workItem: The issue or pull request.
 *
 * Returns:
 *   summariseChanges output for a pull request, or a sentence saying why there are no changes to show.
 *
 * Raises:
 *   Error: The source could not be read; the job retries.
 */
export async function describeChanges(
  db: Database,
  source: SourceAdapter | null,
  workItem: WorkItem,
): Promise<string> {
  if (workItem.kind === "issue") {
    return "This is an issue, so it has no code changes of its own.";
  }
  if (!source) {
    return "The changed files are not available because GitHub is not set up.";
  }
  // Work item ids are the repository's id, then the number: `1043219876#41`.
  const repositoryId = workItem.externalId.split("#")[0];
  const [repository] = await db
    .select()
    .from(repositories)
    .where(
      and(
        eq(repositories.projectId, workItem.projectId),
        eq(repositories.source, workItem.source),
        eq(repositories.externalId, repositoryId),
      ),
    );
  if (!repository) {
    return "The changed files are not available because the repository is no longer connected.";
  }
  return summariseChanges(
    await source.listChangedFiles(repository, workItem.externalId),
  );
}

/**
 * Wrap untrusted text, such as a pull request description or diff, in a tag for the prompt.
 *
 * Args:
 *   tag: The tag name, e.g. `pull_request`.
 *   content: The text.
 *
 * Returns:
 *   The text inside `<tag>` and `</tag>`, with any copies of those tags removed so the text
 *   cannot close the block early.
 */
export function dataBlock(tag: string, content: string): string {
  // Spacing inside the tag is allowed, and removal repeats because taking out one tag can join
  // the text around it into another (`</wo</work_item>rk_item>`).
  const own = new RegExp(`<\\s*/?\\s*${tag}\\s*>`, "gi");
  let text = content;
  let previous;
  do {
    previous = text;
    text = text.replace(own, "");
  } while (text !== previous);
  return `<${tag}>\n${text}\n</${tag}>`;
}

function truncate(text: string, limit: number): string | null {
  if (text.length <= limit) return text;
  // Too little room left to show anything useful.
  if (limit < 200) return null;
  return `${text.slice(0, limit)}\n… (cut)`;
}

function lineCounts(files: SourceChangedFile[]): string {
  const sum = (key: "additions" | "deletions") =>
    files.reduce((total, file) => total + file[key], 0);
  return `(+${sum("additions")} −${sum("deletions")})`;
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
