import { describe, expect, it } from "vitest"
import { parseRipgrepEvent, regexErrorMessage } from "../../src/engines/ripgrepJson"

describe("parseRipgrepEvent", () => {
    it("converts byte offsets after multi-byte characters into UTF-16 offsets", () => {
        const line = JSON.stringify({
            type: "match",
            data: {
                path: { text: "./t.txt" },
                lines: { text: "ü 😀 4.1.0\n" },
                line_number: 2,
                submatches: [{ match: { text: "4.1.0" }, start: 8, end: 13 }]
            }
        })
        expect(parseRipgrepEvent(line)).toEqual({
            kind: "match",
            path: "./t.txt",
            line: 1,
            ranges: [{ start: 5, end: 10 }]
        })
    })

    it("converts each submatch after umlauts and a surrogate pair between them", () => {
        const line = JSON.stringify({
            type: "match",
            data: {
                path: { text: "./t.txt" },
                lines: { text: "ä,ö😀,ü,\n" },
                line_number: 1,
                submatches: [
                    { match: { text: "," }, start: 2, end: 3 },
                    { match: { text: "," }, start: 9, end: 10 },
                    { match: { text: "," }, start: 12, end: 13 }
                ]
            }
        })
        expect(parseRipgrepEvent(line)).toEqual({
            kind: "match",
            path: "./t.txt",
            line: 0,
            ranges: [
                { start: 1, end: 2 },
                { start: 5, end: 6 },
                { start: 7, end: 8 }
            ]
        })
    })

    it("parses a minified line with 100k submatches in under a second", () => {
        const MAX_PARSE_DURATION_MS_ON_A_LOADED_RUNNER = 1000
        const commaCount = 100_000
        const submatches = Array.from({ length: commaCount }, (_, i) => ({
            match: { text: "," },
            start: 3 * i + 2,
            end: 3 * i + 3
        }))
        const line = JSON.stringify({
            type: "match",
            data: {
                path: { text: "./min.js" },
                lines: { text: "ü,".repeat(commaCount) },
                line_number: 1,
                submatches
            }
        })

        const started = performance.now()
        const event = parseRipgrepEvent(line)
        const durationMs = performance.now() - started

        expect(event.kind === "match" && event.ranges.at(-1)).toEqual({
            start: 2 * commaCount - 1,
            end: 2 * commaCount
        })
        expect(durationMs).toBeLessThan(MAX_PARSE_DURATION_MS_ON_A_LOADED_RUNNER)
    })

    it("reports the end of a file", () => {
        expect(
            parseRipgrepEvent(JSON.stringify({ type: "end", data: { path: { text: "./a" } } }))
        ).toEqual({ kind: "end", path: "./a" })
    })

    it("skips lines that ripgrep sends as base64 bytes", () => {
        const line = JSON.stringify({
            type: "match",
            data: {
                path: { text: "./a" },
                lines: { bytes: "/w==" },
                line_number: 1,
                submatches: []
            }
        })
        expect(parseRipgrepEvent(line)).toEqual({ kind: "other" })
    })

    it("skips the summary", () => {
        expect(parseRipgrepEvent(JSON.stringify({ type: "summary", data: {} }))).toEqual({
            kind: "other"
        })
    })
})

describe("regexErrorMessage", () => {
    it("keeps the parser's message alone", () => {
        const stderr =
            "rg: regex parse error:\n    (?:(?<=a)b)\n       ^^^^\nerror: look-around, including look-ahead and look-behind, is not supported\n\nConsider enabling PCRE2 with the --pcre2 flag.\n"
        expect(regexErrorMessage(stderr)).toBe(
            "look-around, including look-ahead and look-behind, is not supported"
        )
    })

    it("falls back to the last line", () => {
        expect(regexErrorMessage("rg: something broke.\n")).toBe("something broke")
    })
})
