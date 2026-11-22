import { FileFolds, findInLine, lineFilter } from "../matching"
import { splitLines } from "../search/results"
import type {
    FileInfo,
    LineMatch,
    PreparedFile,
    Query,
    SearchEngine,
    SearchFile
} from "../search/types"

/** Finds the pieces of a text query in every line of a file, under the matching defaults of `findInLine`. */
export const textEngine = {
    id: "text",

    accepts(_file: FileInfo, query: Query): boolean {
        return query.kind === "text"
    },

    search(file: SearchFile | PreparedFile, query: Query, signal: AbortSignal): LineMatch[] {
        if (query.kind !== "text") return []
        const prepared = "folds" in file ? file : undefined
        const folds = prepared?.folds ?? new FileFolds(file.text)
        const mayMatch = lineFilter(folds, query.pieces, query.matching)
        if (mayMatch === undefined) return []
        const matches: LineMatch[] = []
        const lines = prepared?.lines() ?? splitLines(file.text)
        for (let line = 0; line < lines.length; line++) {
            if (signal.aborted) return []
            const text = lines[line] ?? ""
            if (!mayMatch(line)) continue
            const found = findInLine(text, query.pieces, query.matching, folds)
            if (found.length === 0) continue
            matches.push({
                line,
                ranges: found.flatMap((match) => match.ranges),
                reasons: found.flatMap((match) => match.reasons)
            })
        }
        return matches
    }
} satisfies SearchEngine
