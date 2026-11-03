/** Finds explicit requirement references such as "Implements TL-12" in PR and issue text. Exports parseReferences, Reference. */

/** One requirement a work item says it delivers. */
export type Reference = {
  /** Requirement key, upper-cased, e.g. `TL-12`. */
  key: string;
  relation: "implements" | "part_of";
};

const KEY = String.raw`[a-z]+-\d+`;
// A phrase followed by one key or a list of them: "Part of TL-3, TL-4 and TL-5".
const PHRASE = new RegExp(
  String.raw`\b(implements|part of)\s+(${KEY}(?:\s*(?:,|&|\band\b)\s*${KEY})*)\b`,
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
