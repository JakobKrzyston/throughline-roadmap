/** Finds explicit requirement references such as "Implements TL-12" in PR and issue text. Exports parseReferences, collidesWithRequirementKeys, REQUIREMENT_KEY_PREFIX, Reference. */

/** The prefix of every requirement key: TL-1, TL-2, … */
export const REQUIREMENT_KEY_PREFIX = "TL";

/**
 * Whether a tracker's own issue ids look like requirement keys, as a Linear team keyed TL's do
 * (TL-12). Where one exists, "Part of TL-12" may name that tracker's issue, not a requirement.
 *
 * Args:
 *   teamKey: The prefix of the tracker's issue ids, e.g. a Linear team key.
 *
 * Returns:
 *   True when its issue ids have the same form as requirement keys.
 */
export function collidesWithRequirementKeys(teamKey: string): boolean {
  return teamKey.toUpperCase() === REQUIREMENT_KEY_PREFIX;
}

/** One requirement a work item says it delivers. */
export type Reference = {
  /** Requirement key, upper-cased, e.g. `TL-12`. */
  key: string;
  relation: "implements" | "part_of";
};

const KEY = String.raw`[a-z]+-\d+`;
// A phrase followed by one key or a list of them: "Part of TL-3, TL-4 and TL-5".
// Also accepts "Implements: TL-3", "TL-3, TL-4, and TL-5", and any whitespace inside "part of".
// A key followed by ".digit" (TL-3.1) is not a key, so it is not cut short to TL-3.
const PHRASE = new RegExp(
  String.raw`\b(implements|part\s+of):?\s+(${KEY}(?:\s*(?:,\s*(?:and\b)?|&|\band\b)\s*${KEY})*)\b(?!\.\d)`,
  "gi",
);

/**
 * Find every requirement key that text explicitly references.
 *
 * Matching is case-insensitive. Whether a key exists is not checked here. A key referenced with
 * both phrases counts as `implements`.
 *
 * Args:
 *   text: A PR or issue title and body.
 *
 * Returns:
 *   One reference per distinct key, in order of first appearance.
 */
export function parseReferences(text: string): Reference[] {
  const relations = new Map<string, Reference["relation"]>();
  for (const [, phrase, keyList] of text.matchAll(PHRASE)) {
    const relation =
      phrase.toLowerCase() === "implements" ? "implements" : "part_of";
    for (const [key] of keyList.matchAll(new RegExp(KEY, "gi"))) {
      const normalized = key.toUpperCase();
      if (relations.get(normalized) !== "implements") {
        relations.set(normalized, relation);
      }
    }
  }
  return [...relations].map(([key, relation]) => ({ key, relation }));
}
