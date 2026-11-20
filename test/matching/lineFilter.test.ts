import { describe, expect, it } from "vitest"
import { findInLine, lineFilter } from "../../src/matching"
import { foldedString, foldText } from "../../src/matching/fold"
import { splitLines } from "../../src/search/results"
import { DEFAULT_MATCHING, type MatchingOptions, type TextPiece } from "../../src/search/types"

/**
 * Characters that fold in unusual ways, such as umlauts, combining marks, final sigma and a surrogate pair.
 * The words among them sit close to the query words, so many lines match.
 */
const ALPHABET = [
    ..."abcdeGOrsSzZ019 ._-(",
    "\n",
    "\r",
    "\r\n",
    "ä",
    "Ö",
    "ß",
    "ẞ",
    "ö",
    "̈",
    "̀",
    "̣́",
    "Σ",
    "ς",
    "İ",
    ";",
    "𝐀",
    "\ud800",
    "Grösse",
    "GROESSE",
    "grose",
    "abd",
    "Zero1",
    "utf8Decodr",
    "deCoder"
]

const QUERY_WORDS = ["groesse", "Größe", "abc", "sZ", "zero1", "σ", "ö", "Ab", "decoder"]

/** A generator of the same pseudo-random numbers on every run, so a failure repeats. */
function random(seed: number): () => number {
    let state = seed
    return () => {
        state = (state * 1103515245 + 12345) % 2 ** 31
        return state / 2 ** 31
    }
}

const ASCII_QUERY_WORDS = ["configuration", "decoder", "groesse", "Uri", "httpServer", "abcd"]

function pick<T>(next: () => number, items: readonly T[]): T {
    return items[Math.floor(next() * items.length)]!
}

function randomText(next: () => number, length: number, alphabet = ALPHABET): string {
    let text = ""
    for (let index = 0; index < length; index++) {
        text += pick(next, alphabet)
    }
    return text
}

/** Applies up to two random edits to a word: a swap of two neighbors, a deletion, an insertion or a substitution. */
function misspelled(next: () => number, word: string): string {
    let result = word
    const edits = Math.floor(next() * 3)
    for (let edit = 0; edit < edits && result.length > 1; edit++) {
        const at = Math.floor(next() * (result.length - 1))
        const kind = next()
        const letter = pick(next, [..."aeioxzQ"])
        if (kind < 0.25)
            result = result.slice(0, at) + result[at + 1] + result[at] + result.slice(at + 2)
        else if (kind < 0.5) result = result.slice(0, at) + result.slice(at + 1)
        else if (kind < 0.75) result = result.slice(0, at) + letter + result.slice(at)
        else result = result.slice(0, at) + letter + result.slice(at + 1)
    }
    return result
}

/** An ASCII text of misspelled query words inside camelCase words, so the fuzzy search finds many of them. */
function randomAsciiText(next: () => number): string {
    const tokens = [..." .\n\r_(", "get", "Config", "utf8", "X"]
    let text = ""
    const length = Math.floor(next() * 20)
    for (let index = 0; index < length; index++) {
        text += next() < 0.4 ? misspelled(next, pick(next, ASCII_QUERY_WORDS)) : pick(next, tokens)
    }
    return text
}

function randomPieces(next: () => number, words = QUERY_WORDS): TextPiece[] {
    const pieces: TextPiece[] = []
    const count = 1 + Math.floor(next() * 3)
    for (let index = 0; index < count; index++) {
        const pick = next()
        const value = words[Math.floor(next() * words.length)]!
        if (pick < 0.5) pieces.push({ kind: "word", value, exact: pick < 0.1 })
        else if (pick < 0.8) pieces.push({ kind: "literal", value: pick < 0.65 ? value : "." })
        else pieces.push({ kind: "wildcard" })
    }
    return pieces
}

const MATCHINGS: MatchingOptions[] = [
    DEFAULT_MATCHING,
    { ...DEFAULT_MATCHING, matchCase: true },
    { ...DEFAULT_MATCHING, matchWholeWord: true },
    { ...DEFAULT_MATCHING, umlautVariants: false },
    { ...DEFAULT_MATCHING, fuzzy: false }
]

describe("foldedString", () => {
    it("folds as foldText does", () => {
        const next = random(1)
        for (let run = 0; run < 2000; run++) {
            const text = randomText(next, Math.floor(next() * 30))
            for (const spellOutUmlauts of [false, true]) {
                expect(foldedString(text, spellOutUmlauts)).toBe(
                    foldText(text, spellOutUmlauts).text
                )
            }
        }
    })
})

describe("lineFilter", () => {
    it("keeps every line in which findInLine finds a match", () => {
        const next = random(2)
        let matchedLines = 0
        for (let run = 0; run < 10_000; run++) {
            const text = randomText(next, Math.floor(next() * 80))
            const pieces = randomPieces(next)
            const matching = MATCHINGS[run % MATCHINGS.length]!
            const mayMatch = lineFilter(text, pieces, matching)
            for (const line of splitLines(text)) {
                if (findInLine(line, pieces, matching).length === 0) continue
                matchedLines++
                expect(mayMatch?.(line), JSON.stringify({ text, line, pieces, matching })).toBe(
                    true
                )
            }
        }
        expect(matchedLines).toBeGreaterThan(1000)
    })

    it("keeps every line of an ASCII text in which findInLine finds a match", () => {
        const next = random(3)
        let matchedLines = 0
        for (let run = 0; run < 10_000; run++) {
            const text = randomAsciiText(next)
            const pieces = randomPieces(next, ASCII_QUERY_WORDS)
            const matching = MATCHINGS[run % MATCHINGS.length]!
            const mayMatch = lineFilter(text, pieces, matching)
            for (const line of splitLines(text)) {
                if (findInLine(line, pieces, matching).length === 0) continue
                matchedLines++
                expect(mayMatch?.(line), JSON.stringify({ text, line, pieces, matching })).toBe(
                    true
                )
            }
        }
        expect(matchedLines).toBeGreaterThan(1000)
    })

    it("rules out a file that holds none of a piece", () => {
        const pieces: TextPiece[] = [{ kind: "word", value: "configuration", exact: false }]
        expect(lineFilter("const a = 1\nconst b = 2\n", pieces)).toBeUndefined()
        expect(lineFilter("const configuratoin = 1\n", pieces)).toBeDefined()
    })

    it("keeps a file whose line starts with a combining mark that the file folds with the line break", () => {
        // NFC maps U+0340 to U+0300 once the file joins it to the line break before it.
        const pieces: TextPiece[] = [{ kind: "literal", value: "\u0340" }]
        const text = "a\n\u0340b"
        expect(findInLine("\u0340b", pieces)).toHaveLength(1)
        expect(lineFilter(text, pieces)?.("\u0340b")).toBe(true)
    })

    it("keeps a word of an ASCII file that two swaps of neighbors make from the query word", () => {
        // Each swap breaks two runs of the query word, so three runs would leave none intact.
        const pieces: TextPiece[] = [{ kind: "word", value: "configuration", exact: false }]
        const line = "const conifguratoin = 1"
        expect(findInLine(line, pieces)).toHaveLength(1)
        expect(lineFilter(line, pieces)?.(line)).toBe(true)
    })

    it("drops the lines that hold none of a piece", () => {
        const pieces: TextPiece[] = [{ kind: "word", value: "configuration", exact: false }]
        const mayMatch = lineFilter("a configuratoin\nnothing here\nConfiguration\n", pieces)!
        expect(mayMatch("a configuratoin")).toBe(true)
        expect(mayMatch("nothing here")).toBe(false)
        expect(mayMatch("Configuration")).toBe(true)
    })
})
