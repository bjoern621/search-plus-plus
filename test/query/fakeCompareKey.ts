import type { MatchReason } from "../../src/search/types";
import type { CompareKey } from "../../src/query/types";

const UMLAUTS: [RegExp, string][] = [
  [/ä/g, "ae"],
  [/ö/g, "oe"],
  [/ü/g, "ue"],
  [/ß/g, "ss"],
];

function fold(text: string): string {
  return UMLAUTS.reduce((folded, [umlaut, spelledOut]) => folded.replace(umlaut, spelledOut), text.toLowerCase());
}

/** Optimal string alignment distance: inserts, deletes, replacements and swaps of neighbours. */
function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
      }
    }
  }
  return d[a.length]![b.length]!;
}

function allowedEdits(word: string): number {
  return word.length <= 2 ? 0 : word.length <= 5 ? 1 : 2;
}

/** Stands in for the matching defaults: case-insensitive, umlaut variants, Elasticsearch AUTO fuzziness. */
export const fakeCompareKey: CompareKey = (literal, keyText, how) => {
  if (literal === keyText) {
    return { reasons: [] };
  }
  if (how.exact) {
    return undefined;
  }
  if (literal.toLowerCase() === keyText.toLowerCase()) {
    return { reasons: [{ kind: "case", query: literal, found: keyText }] };
  }
  if (fold(literal) === fold(keyText)) {
    return { reasons: [{ kind: "umlaut", query: literal, found: keyText }] };
  }
  if (!how.fuzzy) {
    return undefined;
  }
  const edits = editDistance(fold(literal), fold(keyText));
  if (edits > allowedEdits(literal)) {
    return undefined;
  }
  const reason: MatchReason = { kind: "fuzzy", query: literal, found: keyText, edits };
  return { reasons: [reason] };
};
