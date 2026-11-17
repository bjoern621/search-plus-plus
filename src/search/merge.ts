import { assert } from "./assert";
import type { LineMatch, MatchReason, Range } from "./types";

/**
 * Merges the matches that several engines found in one file.
 * A line that several engines find appears once, with the union of their ranges and reasons.
 * Returns the lines in ascending order.
 */
export function mergeLineMatches(lists: readonly (readonly LineMatch[])[]): LineMatch[] {
  const byLine = new Map<number, LineMatch>();
  for (const list of lists) {
    for (const match of list) {
      const known = byLine.get(match.line);
      if (!known) {
        byLine.set(match.line, { ...match, ranges: [...match.ranges], reasons: [...match.reasons] });
        continue;
      }
      known.ranges.push(...match.ranges);
      known.reasons.push(...match.reasons);
      known.keyPath ??= match.keyPath;
    }
  }
  return [...byLine.values()]
    .map((match) => ({ ...match, ranges: unionRanges(match.ranges), reasons: distinctReasons(match.reasons) }))
    .sort((a, b) => a.line - b.line);
}

/** Sorts ranges and joins the ones that overlap or touch. Drops empty ranges. */
export function unionRanges(ranges: readonly Range[]): Range[] {
  for (const range of ranges) assert(range.start >= 0 && range.start <= range.end, "a range must start at 0 or later and end at or after its start");
  const sorted = ranges.filter((range) => range.end > range.start).sort((a, b) => a.start - b.start);
  const union: Range[] = [];
  for (const range of sorted) {
    const last = union.at(-1);
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
      continue;
    }
    union.push({ ...range });
  }
  return union;
}

function distinctReasons(reasons: readonly MatchReason[]): MatchReason[] {
  const seen = new Set<string>();
  return reasons.filter((reason) => {
    const key = JSON.stringify(reason);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
