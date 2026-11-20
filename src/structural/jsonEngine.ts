import { visit } from "jsonc-parser"
import type { VisitKeyPath } from "../api"
import { keyPathEngine } from "./keyPathEngine"

type Container = { kind: "object" } | { kind: "array"; nextIndex: number }

/**
 * Finds key paths in JSON files, with comments and trailing commas as in `tsconfig.json`.
 * The parser reads past errors, so a broken part yields no keys and the rest still matches.
 */
export const jsonEngine = keyPathEngine({
    id: "jsonKeyPath",
    languageIds: ["json", "jsonc"],
    extensions: [".json", ".jsonc"],
    readKeys: walkJson
})

/**
 * Visits every property and every array item with its key path.
 * A property highlights its key, quotes included.
 * An array item highlights its value, or its opening bracket for an object or an array.
 */
function walkJson(text: string, visitKeyPath: VisitKeyPath): void {
    const containers: Container[] = []
    // keys[i] holds the current key inside containers[i].
    const keys: string[] = []

    const enterKey = (key: string, offset: number, length: number): void => {
        keys.length = containers.length - 1
        keys.push(key)
        visitKeyPath(keys, offset, offset + length)
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
