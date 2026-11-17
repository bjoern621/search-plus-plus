import { describe, expect, it } from "vitest"
import { textEngine } from "../../src/engines/text"
import { parseQuery } from "../../src/query"

const file = { uri: "file:///w/a.txt", relativePath: "a.txt", languageId: "plaintext" }
const signal = new AbortController().signal

describe("textEngine", () => {
    it("finds every occurrence in a line, whatever its case", () => {
        const text = "Gravitee and gravitee\nnothing\n  GRAVITEE"
        const matches = textEngine.search({ ...file, text }, parseQuery("gravitee"), signal)
        expect(matches.map(({ line, ranges }) => ({ line, ranges }))).toEqual([
            {
                line: 0,
                ranges: [
                    { start: 0, end: 8 },
                    { start: 13, end: 21 }
                ]
            },
            { line: 2, ranges: [{ start: 2, end: 10 }] }
        ])
    })

    it("keeps the offsets of the line around astral characters", () => {
        const matches = textEngine.search(
            { ...file, text: "😀 Größe" },
            parseQuery("größe"),
            signal
        )
        expect(matches.map(({ line, ranges }) => ({ line, ranges }))).toEqual([
            { line: 0, ranges: [{ start: 3, end: 8 }] }
        ])
    })

    it("carries the reasons of a close spelling", () => {
        const matches = textEngine.search(
            { ...file, text: "gravitee: true" },
            parseQuery("gravitea"),
            signal
        )
        expect(matches).toHaveLength(1)
        expect(matches[0]?.reasons.map((reason) => reason.kind)).toContain("fuzzy")
    })

    it("accepts text queries and declines regex queries", () => {
        expect(textEngine.accepts(file, parseQuery("a"))).toBe(true)
        expect(textEngine.accepts(file, parseQuery("/a/"))).toBe(false)
    })
})
