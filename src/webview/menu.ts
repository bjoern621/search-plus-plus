import type { FileResult, ResultLine } from "../messages"
import type { MatchReason } from "../search/types"
import { fileEntry, folderEntry } from "./exclusions"
import { keyPathText } from "./keyPath"

export type MenuAction =
    | { kind: "search"; query: string }
    | { kind: "exclude"; entry: string }
    | { kind: "copyLine" }
    | { kind: "copy"; text: string }
    | { kind: "reveal"; uri: string }

export interface MenuItem {
    label: string
    action: MenuAction
}

/** A menu: lines that explain it, then groups of actions with a separator between them. */
export interface MenuContent {
    reasons: string[]
    groups: MenuItem[][]
}

/** Lays out the context menu of the matched `line`. `query` holds the text of the search that found it. Its reasons say why the line matched. */
export function matchMenu(file: FileResult, line: ResultLine, query: string): MenuContent {
    const reasons = line.reasons ?? []
    const groups: MenuItem[][] = []
    const exactMatch = exactMatchItem(reasons, query)
    if (exactMatch) groups.push([exactMatch])

    const exclusions: MenuItem[] = [
        { label: `Exclude ${file.name}`, action: { kind: "exclude", entry: fileEntry(file) } }
    ]
    if (file.folder !== "")
        exclusions.push({
            label: `Exclude folder ${file.folder}`,
            action: { kind: "exclude", entry: folderEntry(file.folder) }
        })
    groups.push(exclusions)

    const copies: MenuItem[] = [{ label: "Copy matched line", action: { kind: "copyLine" } }]
    if (line.keyPath)
        copies.push({
            label: "Copy key path",
            action: { kind: "copy", text: keyPathText(line.keyPath) }
        })
    groups.push(copies)

    return { reasons: reasonLines(reasons, line.keyPath ?? []), groups }
}

/** Lays out the context menu of a file row. */
export function fileMenu(file: FileResult): MenuContent {
    const exclusions: MenuItem[] = [
        { label: `Exclude ${file.name}`, action: { kind: "exclude", entry: fileEntry(file) } }
    ]
    if (file.folder !== "")
        exclusions.push({
            label: `Exclude folder ${file.folder}`,
            action: { kind: "exclude", entry: folderEntry(file.folder) }
        })
    return {
        reasons: [],
        groups: [
            [{ label: "Reveal in Explorer", action: { kind: "reveal", uri: file.uri } }],
            exclusions
        ]
    }
}

/** Lays out the context menu of the folder at `uri`, whose path relative to its workspace folder reads `folder`. */
export function folderMenu(uri: string, folder: string): MenuContent {
    return {
        reasons: [],
        groups: [
            [{ label: "Reveal in Explorer", action: { kind: "reveal", uri } }],
            [
                {
                    label: `Exclude folder ${folder}`,
                    action: { kind: "exclude", entry: folderEntry(folder) }
                }
            ]
        ]
    }
}

/** Searches again with the first word that a matching default stretched in quotes, so it matches exactly. */
function exactMatchItem(reasons: readonly MatchReason[], query: string): MenuItem | undefined {
    const reason = ["fuzzy", "umlaut", "case"]
        .map((kind) => reasons.find((candidate) => candidate.kind === kind))
        .find((candidate) => candidate !== undefined)
    if (!reason) return undefined
    const quoted = quoteWord(query, reason.query)
    if (quoted === undefined) return undefined
    return { label: `Match "${reason.query}" exactly`, action: { kind: "search", query: quoted } }
}

/**
 * Puts quotes around the first occurrence of `word` in `query` that stands as a whole word outside quotes and escapes.
 * Returns `undefined` when `query` holds no such occurrence.
 */
export function quoteWord(query: string, word: string): string | undefined {
    let quoted = false
    for (let i = 0; i < query.length; i++) {
        const char = query[i]
        if (char === "\\") {
            i++
            continue
        }
        if (char === '"') {
            quoted = !quoted
            continue
        }
        if (quoted || !query.startsWith(word, i)) continue
        const end = i + word.length
        if (isWordChar(query[i - 1]) || isWordChar(query[end])) continue
        return `${query.slice(0, i)}"${word}"${query.slice(end)}`
    }
    return undefined
}

function isWordChar(char: string | undefined): boolean {
    return char !== undefined && /[\p{L}\p{N}]/u.test(char)
}

/**
 * Says in one line per reason why the line matched, such as `Key gravitee: 1 letter off from Gravite.`
 * Case differences share one line, such as `Keys global, values and enabled: case differs.`
 */
export function reasonLines(reasons: readonly MatchReason[], keyPath: readonly string[]): string[] {
    const keys = new Set(keyPath)
    const lines: string[] = []
    const caseKeys: string[] = []
    const caseWords: string[] = []
    for (const reason of reasons) {
        const isKey = keys.has(reason.found)
        switch (reason.kind) {
            case "fuzzy":
                lines.push(
                    `${isKey ? "Key " : ""}${reason.found}: ${reason.edits} ${reason.edits === 1 ? "letter" : "letters"} off from ${reason.query}.`
                )
                break
            case "umlaut":
                lines.push(
                    `${isKey ? "Key " : ""}${reason.found}: ${reason.query} written ${umlautCount(reason.found) < umlautCount(reason.query) ? "without" : "with"} umlauts.`
                )
                break
            case "case":
                ;(isKey ? caseKeys : caseWords).push(reason.found)
                break
        }
    }
    if (caseKeys.length > 0)
        lines.push(`${caseKeys.length === 1 ? "Key" : "Keys"} ${listText(caseKeys)}: case differs.`)
    if (caseWords.length > 0) lines.push(`${listText(caseWords)}: case differs.`)
    return lines
}

function umlautCount(text: string): number {
    return [...text].filter((char) => "äöüÄÖÜß".includes(char)).length
}

/** Joins words as in a sentence: `a`, `a and b`, `a, b and c`. */
function listText(words: readonly string[]): string {
    if (words.length <= 1) return words.join("")
    return `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`
}
