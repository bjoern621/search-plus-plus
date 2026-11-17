import { findInChain } from "../query";
import type { KeyPathPattern } from "../query/types";
import type { FileInfo, LineMatch, Query, SearchEngine, SearchFile } from "../search/types";
import { compareKeyDefault } from "./compareKeyDefault";
import { CODE_FILES, isFileOfKind, keyPathOf } from "./fileKinds";
import { cachedCompareKey, lineMatch, reasonsOf } from "./keyPathCollector";
import { LineIndex } from "./lineIndex";
import { memberChains, type ChainKey } from "./memberChains";

const ABORT_CHECK_INTERVAL_CHAINS = 1024;

/**
 * Finds key paths in the member access chains of JavaScript and TypeScript.
 * `config.server.port` finds `this.config.server.port`, `config?.server.port` and `config["server"].port`.
 * A match covers two keys or more, so a lone name stays with the plain text engine.
 * A chain that spans several lines gives a match on each of its lines, all with the same key path.
 */
export const codeEngine: SearchEngine = {
  id: "codeMemberChain",

  accepts(file: FileInfo, query: Query): boolean {
    const pattern = keyPathOf(query);
    return pattern !== undefined && spansSeveralKeys(pattern) && isFileOfKind(file, CODE_FILES);
  },

  search(file: SearchFile, query: Query, signal: AbortSignal): LineMatch[] {
    const pattern = keyPathOf(query);
    if (pattern === undefined) {
      return [];
    }
    const lines = new LineIndex(file.text);
    const compareKey = cachedCompareKey(compareKeyDefault);
    const matches: LineMatch[] = [];
    const chains = memberChains(file.text);
    for (let i = 0; i < chains.length; i++) {
      if (i % ABORT_CHECK_INTERVAL_CHAINS === 0 && signal.aborted) {
        return [];
      }
      const chain = chains[i]!;
      const match = findInChain(
        pattern,
        chain.map((key) => key.name),
        compareKey,
      );
      if (match === undefined || match.end - match.start < 2) {
        continue;
      }
      matches.push(...matchesPerLine(lines, chain.slice(match.start, match.end), reasonsOf(match)));
    }
    return matches;
  },
};

/** A pattern of one segment matches one key alone, unless a group in it holds a dot. */
function spansSeveralKeys(pattern: KeyPathPattern): boolean {
  return (
    pattern.segments.length >= 2 ||
    pattern.segments.some(
      (segment) => segment.kind === "key" && segment.pieces.some((piece) => piece.kind === "group" && piece.alternatives.some((alternative) => alternative.length >= 2)),
    )
  );
}

/** One match per line of the run, each covering the part of the run on its line. */
function matchesPerLine(lines: LineIndex, run: ChainKey[], reasons: LineMatch["reasons"]): LineMatch[] {
  const keyPath = run.map((key) => key.name);
  const matches: LineMatch[] = [];
  let first = run[0]!;
  let firstLine = lines.lineAt(first.start);
  let last = first;
  for (const key of run.slice(1)) {
    const line = lines.lineAt(key.start);
    if (line !== firstLine) {
      matches.push(lineMatch(lines, first.start, last.end, keyPath, reasons));
      first = key;
      firstLine = line;
    }
    last = key;
  }
  matches.push(lineMatch(lines, first.start, last.end, keyPath, reasons));
  return matches;
}
