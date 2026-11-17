import { visit } from "jsonc-parser"
import type { FileInfo, LineMatch, Query, SearchEngine, SearchFile } from "../search/types"
import { compareKeyFor } from "./compareKeyDefault"
import { isFileOfKind, JSON_FILES, keyPathOf } from "./fileKinds"
import { KeyPathCollector, SearchAborted } from "./keyPathCollector"

type Container = { kind: "object" } | { kind: "array"; nextIndex: number }

/**
 * Finds key paths in JSON files, with comments and trailing commas as in `tsconfig.json`.
 * The parser reads past errors, so a broken part yields no keys and the rest still matches.
 */
export const jsonEngine: SearchEngine = {
    id: "jsonKeyPath",

    accepts(file: FileInfo, query: Query): boolean {
        return keyPathOf(query) !== undefined && isFileOfKind(file, JSON_FILES)
    },

    search(file: SearchFile, query: Query, signal: AbortSignal): LineMatch[] {
        const pattern = keyPathOf(query)
        if (pattern === undefined) {
            return []
        }
        const collector = new KeyPathCollector(file.text, pattern, compareKeyFor(query), signal)
        try {
            walkJson(file.text, collector)
        } catch (error) {
            if (error instanceof SearchAborted) {
                return []
            }
            throw error
        }
        return collector.results()
    }
}

/**
 * Visits every property and every array item with its key path.
 * A property highlights its key, quotes included.
 * An array item highlights its value, or its opening bracket for an object or an array.
 */
function walkJson(text: string, collector: KeyPathCollector): void {
    const containers: Container[] = []
    // keys[i] holds the current key inside containers[i].
    const keys: string[] = []

    const enterKey = (key: string, offset: number, length: number): void => {
        keys.length = containers.length - 1
        keys.push(key)
        collector.visit(keys, offset, offset + length)
    }
    const startValue = (offset: number, length: number): void => {
        const parent = containers.at(-1)
        if (parent?.kind === "array") {
            enterKey(String(parent.nextIndex++), offset, length)
        }
    }
    const leave = (): void => {
        containers.pop()
        keys.length = containers.length
    }

    visit(
        text,
        {
            onObjectBegin: (offset, length) => {
                startValue(offset, length)
                containers.push({ kind: "object" })
            },
            onObjectProperty: (property, offset, length) => {
                if (containers.at(-1)?.kind === "object") {
                    enterKey(property, offset, length)
                }
            },
            onObjectEnd: leave,
            onArrayBegin: (offset, length) => {
                startValue(offset, length)
                containers.push({ kind: "array", nextIndex: 0 })
            },
            onArrayEnd: leave,
            onLiteralValue: (_value, offset, length) => startValue(offset, length)
        },
        { allowTrailingComma: true, disallowComments: false, allowEmptyContent: true }
    )
}
