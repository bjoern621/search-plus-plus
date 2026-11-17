import { matchKeyPath, usesKeyPathSyntax } from "../query";
import type { CompareKey, KeyMatch, KeyPathMatch, KeyPathPattern, KeyPathSegment } from "../query/types";
import type { LineMatch, MatchReason, Range } from "../search/types";
import { LineIndex } from "./lineIndex";

/** Thrown out of a walk once the search gets cancelled. The engine catches it and returns no matches. */
export class SearchAborted extends Error {
  constructor() {
    super("Search aborted");
  }
}

const ABORT_CHECK_INTERVAL_NODES = 1024;

/**
 * Collects the nodes of one file whose key path matches the pattern.
 * A walker passes in every node with its keys and the file range to highlight.
 * A node met twice at the same offset keeps one match.
 * A match met directly wins over one met through a YAML alias, so it shows the key path as written.
 */
export class KeyPathCollector {
  private readonly lines: LineIndex;
  /** Maps the file offset of a matched node to its match. */
  private readonly matches = new Map<number, { match: LineMatch; throughAlias: boolean }>();
  private readonly compareKey: CompareKey;
  private readonly filters: PositionFilters;
  private readonly showKeyPath: boolean;
  private visitedNodes = 0;

  constructor(
    text: string,
    private readonly pattern: KeyPathPattern,
    compareKey: CompareKey,
    private readonly signal: AbortSignal,
  ) {
    this.lines = new LineIndex(text);
    this.compareKey = cachedCompareKey(compareKey);
    this.filters = positionFilters(pattern, this.compareKey);
    this.showKeyPath = usesKeyPathSyntax(pattern);
  }

  /**
   * Matches the key path of one node.
   * `start` and `end` are file offsets of the text that the match highlights, cut at the end of its first line.
   * The collector reads `keys` during the call alone, so the walker may reuse the array.
   * `throughAlias` marks a node that the walk reached through an alias or a merge key.
   * Throws `SearchAborted` once the signal fires.
   */
  visit(keys: string[], start: number, end: number, throughAlias = false): void {
    this.visitedNodes++;
    if (this.visitedNodes % ABORT_CHECK_INTERVAL_NODES === 0 && this.signal.aborted) {
      throw new SearchAborted();
    }
    const earlier = this.matches.get(start);
    if (earlier !== undefined && (throughAlias || !earlier.throughAlias)) {
      return;
    }
    if (!passesFilters(this.filters, keys)) {
      return;
    }
    const match = matchKeyPath(this.pattern, keys, this.compareKey);
    if (match === undefined) {
      return;
    }
    const found = lineMatch(this.lines, start, end, [...keys], reasonsOf(match));
    this.matches.set(start, { match: this.showKeyPath ? { ...found, showKeyPath: true } : found, throughAlias });
  }

  /** The matches in the order of their lines and ranges. */
  results(): LineMatch[] {
    return [...this.matches.values()].map((entry) => entry.match).sort((a, b) => a.line - b.line || (a.ranges[0]?.start ?? 0) - (b.ranges[0]?.start ?? 0));
  }
}

/** Says whether a key may match a segment. */
type KeyFilter = (key: string) => boolean;

/**
 * Filters for the segments that sit at a fixed position: before the first globstar or group, counted from the start,
 * and after the last one, counted from the end.
 * Each such segment matches exactly one key, so a node fails the pattern once one of its keys fails the filter at its position.
 * The filters cost a cached lookup per key, which spares most nodes the full matcher.
 */
interface PositionFilters {
  /** Per segment from the start, its filter, or undefined for a segment that every key may match. */
  leading: (KeyFilter | undefined)[];
  /** Per segment from the end, its filter, or undefined. */
  trailing: (KeyFilter | undefined)[];
}

function positionFilters(pattern: KeyPathPattern, compareKey: CompareKey): PositionFilters {
  const segments = pattern.segments;
  const firstVariable = segments.findIndex(isVariable);
  if (firstVariable === -1) {
    return { leading: segments.map((segment) => keyFilter(segment, compareKey)), trailing: [] };
  }
  const lastVariable = segments.length - 1 - [...segments].reverse().findIndex(isVariable);
  return {
    leading: segments.slice(0, firstVariable).map((segment) => keyFilter(segment, compareKey)),
    trailing: segments
      .slice(lastVariable + 1)
      .reverse()
      .map((segment) => keyFilter(segment, compareKey)),
  };
}

/** A globstar or a group, which match a varying number of keys. */
function isVariable(segment: KeyPathSegment): boolean {
  return segment.kind === "globstar" || segment.pieces.some((piece) => piece.kind === "group");
}

function passesFilters(filters: PositionFilters, keys: string[]): boolean {
  if (keys.length < filters.leading.length + filters.trailing.length) {
    return false;
  }
  for (let i = 0; i < filters.leading.length; i++) {
    if (filters.leading[i]?.(keys[i]!) === false) {
      return false;
    }
  }
  for (let i = 0; i < filters.trailing.length; i++) {
    if (filters.trailing[i]?.(keys[keys.length - 1 - i]!) === false) {
      return false;
    }
  }
  return true;
}

/**
 * The filter of a segment made of one literal or one quoted piece, which has to match a whole key.
 * Returns undefined for every other segment.
 */
function keyFilter(segment: KeyPathSegment, compareKey: CompareKey): KeyFilter | undefined {
  const only = segment.kind === "key" && segment.pieces.length === 1 ? segment.pieces[0] : undefined;
  if (only?.kind !== "literal" && only?.kind !== "quoted") {
    return undefined;
  }
  const how = only.kind === "quoted" ? { exact: true, fuzzy: false } : { exact: false, fuzzy: true };
  const verdicts = new Map<string, boolean>();
  return (key) => {
    let verdict = verdicts.get(key);
    if (verdict === undefined) {
      verdict = compareKey(only.value, key, how) !== undefined;
      verdicts.set(key, verdict);
    }
    return verdict;
  };
}

/** A match on the line of `start`. An empty file range gives a match without ranges. */
export function lineMatch(lines: LineIndex, start: number, end: number, keyPath: string[], reasons: MatchReason[]): LineMatch {
  const line = lines.lineAt(start);
  const range: Range = lines.rangeInLine(line, start, end);
  return { line, ranges: range.end > range.start ? [range] : [], reasons, keyPath };
}

export function reasonsOf(match: KeyPathMatch): MatchReason[] {
  return match.keys.flatMap((key) => key.reasons);
}

/**
 * Remembers each comparison for the lifetime of one search.
 * A large file repeats its keys many times, and folding a key allocates.
 */
export function cachedCompareKey(compareKey: CompareKey): CompareKey {
  const cache = new Map<string, KeyMatch | undefined>();
  return (literal, keyText, how) => {
    const cacheKey = `${how.exact ? 1 : 0}${how.fuzzy ? 1 : 0}${literal}\u0000${keyText}`;
    if (cache.has(cacheKey)) {
      return cache.get(cacheKey);
    }
    const match = compareKey(literal, keyText, how);
    cache.set(cacheKey, match);
    return match;
  };
}
