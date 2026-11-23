import { describe, expect, it } from "vitest"
import type { FileResult, ResultLine } from "../../src/messages"
import { cutToMatch, groupAround, groupDedents, targetLine } from "../../src/webview/codeLines"
import { highlightParts, type Row } from "../../src/webview/tree"

const line = (number: number, match: boolean, text = `line ${number}`): ResultLine => ({
    line: number,
    text,
    offset: 0,
    match,
    ranges: match ? [{ start: 0, end: 4 }] : []
})

/** The rows of one file whose blocks hold `blocks`, with the blank context lines left out as the tree does. */
function rowsOf(blocks: ResultLine[][]): Row[] {
    const file = { blocks } as unknown as FileResult
    return blocks
        .flat()
        .filter((shown) => shown.match || shown.text.trim() !== "")
        .map((shown) => ({ kind: "line", depth: 1, file, line: shown }))
}

const lineOf = (row: Row | undefined) => (row?.kind === "line" ? row.line : undefined)

describe("targetLine", () => {
    it("opens the matched line from every line of its group", () => {
        const rows = rowsOf([[line(4, false), line(5, true), line(6, false)]])
        for (const index of [0, 1, 2]) expect(targetLine(rows, index)).toBe(lineOf(rows[1]))
    })

    it("opens the match of its own group in a block that a blank line splits", () => {
        const rows = rowsOf([
            [line(53, false), line(54, true), line(55, false, ""), line(56, false), line(57, true)]
        ])
        expect(targetLine(rows, 0)).toBe(lineOf(rows[1]))
        expect(targetLine(rows, 2)).toBe(lineOf(rows[3]))
    })

    it("opens the match of the block from a group without one", () => {
        const rows = rowsOf([[line(4, true), line(5, false, ""), line(6, false)]])
        expect(targetLine(rows, 1)).toBe(lineOf(rows[0]))
    })
})

describe("groupAround", () => {
    it("ends a group at a blank line that takes no row", () => {
        const rows = rowsOf([
            [line(53, false), line(54, true), line(55, false, ""), line(56, false), line(57, true)]
        ])
        expect(groupAround(rows, 1)).toEqual({ first: 0, last: 1 })
        expect(groupAround(rows, 2)).toEqual({ first: 2, last: 3 })
    })

    it("keeps two blocks of a file apart", () => {
        const rows = rowsOf([[line(1, true)], [line(9, true)]])
        expect(groupAround(rows, 0)).toEqual({ first: 0, last: 0 })
    })
})

describe("groupDedents", () => {
    it("dedents each group by its own least indentation", () => {
        const rows = rowsOf([
            [
                line(1, true, "    a"),
                line(2, false, "        b"),
                line(3, false, ""),
                line(4, true, "  c")
            ]
        ])
        expect(groupDedents(rows)).toEqual([4, 4, 2])
    })
})

describe("cutToMatch", () => {
    const twoMatches: ResultLine = {
        line: 43,
        text: '  namespace: {{ include "instance.namespace" . }}',
        offset: 0,
        match: true,
        ranges: [
            { start: 2, end: 11 },
            { start: 34, end: 43 }
        ]
    }

    it("leaves a line whose first match fits", () => {
        expect(cutToMatch(twoMatches, 20)).toBeUndefined()
    })

    it("cuts the line to show the second match", () => {
        const cut = cutToMatch(twoMatches, 20, 1)
        expect(cut?.text.startsWith("  ")).toBe(true)
        const [, second] = twoMatches.ranges
        const start = (second?.start ?? 0) - (cut?.offset ?? 0)
        expect(cut?.text.slice(start, start + 9)).toBe("namespace")
        expect(start + 9).toBeLessThanOrEqual(20)
    })

    it("leaves a line without the range", () => {
        expect(cutToMatch(twoMatches, 20, 2)).toBeUndefined()
    })
})

describe("highlightParts", () => {
    it("gives each marked part the index of its range", () => {
        const parts = highlightParts({
            line: 0,
            text: "a b a",
            offset: 0,
            match: true,
            ranges: [
                { start: 0, end: 1 },
                { start: 4, end: 5 }
            ]
        })
        expect(parts).toEqual([{ text: "a", match: 0 }, { text: " b " }, { text: "a", match: 1 }])
    })
})
