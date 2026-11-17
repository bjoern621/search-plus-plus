import { readFileSync } from "node:fs"
import { join } from "node:path"
import { parseQuery } from "../../src/query"
import type { LineMatch, SearchEngine } from "../../src/search/types"

export function fixture(name: string): string {
    return readFileSync(join(__dirname, "fixtures", name), "utf8")
}

/** Runs one engine on a text and returns its matches. Asserts that the engine accepts the file and the query. */
export function search(
    engine: SearchEngine,
    relativePath: string,
    languageId: string,
    text: string,
    rawQuery: string
): LineMatch[] {
    const file = { uri: `file:///${relativePath}`, relativePath, languageId, text }
    const query = parseQuery(rawQuery)
    if (!engine.accepts(file, query)) {
        throw new Error(
            `Expected ${engine.id} to accept ${relativePath} with the query ${rawQuery}`
        )
    }
    const result = engine.search(file, query, new AbortController().signal)
    if (result instanceof Promise) {
        throw new Error(`Expected ${engine.id} to search synchronously`)
    }
    return result
}

/** Each match as "line: key path", with 1-based lines as the editor shows them. */
export function found(matches: LineMatch[]): string[] {
    return matches.map((match) => `${match.line + 1}: ${match.keyPath?.join(".")}`)
}

/** The text that each match highlights. */
export function highlighted(text: string, matches: LineMatch[]): string[] {
    const lines = text.split(/\r?\n/)
    return matches.flatMap((match) =>
        match.ranges.map((range) => lines[match.line]!.slice(range.start, range.end))
    )
}
