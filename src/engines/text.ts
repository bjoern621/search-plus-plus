import { findInLine } from "../matching";
import { splitLines } from "../search/results";
import type { FileInfo, LineMatch, Query, SearchEngine, SearchFile } from "../search/types";

/** Finds the pieces of a text query in every line of a file, under the matching defaults of `findInLine`. */
export const textEngine = {
  id: "text",

  accepts(_file: FileInfo, query: Query): boolean {
    return query.kind === "text";
  },

  search(file: SearchFile, query: Query, signal: AbortSignal): LineMatch[] {
    if (query.kind !== "text") return [];
    const matches: LineMatch[] = [];
    const lines = splitLines(file.text);
    for (let line = 0; line < lines.length; line++) {
      if (signal.aborted) return [];
      const found = findInLine(lines[line] ?? "", query.pieces);
      if (found.length === 0) continue;
      matches.push({ line, ranges: found.flatMap((match) => match.ranges), reasons: found.flatMap((match) => match.reasons) });
    }
    return matches;
  },
} satisfies SearchEngine;
