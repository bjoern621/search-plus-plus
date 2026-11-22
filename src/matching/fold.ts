import { assert } from "./assert"
import type { Range } from "../search/types"

const COMBINING_MARK = /\p{M}/u
const ASCII_ONLY = /^[\x00-\x7f]*$/
/** A character that folds other than by ASCII lower-casing: one with combining marks, or a single non-ASCII code point. */
const OTHER_THAN_ASCII_CHARACTER = /[\s\S]\p{M}+|[^\x00-\x7f]/gu
const UMLAUT = /[äöüß]/g
const UMLAUT_SPELLINGS: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", ß: "ss" }
const UMLAUT_ANY_CASE = /[äöüßÄÖÜẞ]/g
const UMLAUT_SPELLINGS_ANY_CASE: Record<string, string> = {
    ...UMLAUT_SPELLINGS,
    Ä: "Ae",
    Ö: "Oe",
    Ü: "Ue",
    ẞ: "SS"
}

/**
 * A text in lower case, umlauts spelled out on request, with the original offsets of each folded code unit.
 * A character means one code point and the combining marks after it, so a decomposed `o` + U+0308 folds like `ö`.
 */
export interface FoldedText {
    text: string
    /** Per folded code unit: the original offset where its character starts. */
    starts: number[]
    /** Per folded code unit: the original offset where its character ends. */
    ends: number[]
    /** Per original offset: the folded offset of the character starting there, -1 inside a character. */
    foldedOffsets: Int32Array
}

export function foldText(text: string, spellOutUmlauts: boolean): FoldedText {
    if (ASCII_ONLY.test(text)) {
        return foldAscii(text)
    }
    let folded = ""
    const starts: number[] = []
    const ends: number[] = []
    const foldedOffsets = new Int32Array(text.length + 1).fill(-1)
    let index = 0
    while (index < text.length) {
        const end = characterEnd(text, index)
        const character = foldCharacter(text, index, end, spellOutUmlauts)
        foldedOffsets[index] = folded.length
        folded += character
        for (let unit = 0; unit < character.length; unit++) {
            starts.push(index)
            ends.push(end)
        }
        index = end
    }
    foldedOffsets[text.length] = folded.length
    return { text: folded, starts, ends, foldedOffsets }
}

/** `foldText` for ASCII text, where each character folds to one code unit at its own offset. */
function foldAscii(text: string): FoldedText {
    const starts: number[] = []
    const ends: number[] = []
    const foldedOffsets = new Int32Array(text.length + 1)
    for (let index = 0; index < text.length; index++) {
        starts.push(index)
        ends.push(index + 1)
        foldedOffsets[index] = index
    }
    foldedOffsets[text.length] = text.length
    return { text: text.toLowerCase(), starts, ends, foldedOffsets }
}

/**
 * Returns the text of `foldText` without the offsets, at a fraction of the cost.
 * ASCII characters fold with `toLowerCase` on whole runs, every other character as `foldText` folds it.
 */
export function foldedString(text: string, spellOutUmlauts: boolean): string {
    if (ASCII_ONLY.test(text)) {
        return text.toLowerCase()
    }
    let folded = ""
    let asciiFrom = 0
    for (const character of text.matchAll(OTHER_THAN_ASCII_CHARACTER)) {
        const start = character.index
        const end = start + character[0].length
        folded += text.slice(asciiFrom, start).toLowerCase()
        folded += foldCharacter(text, start, end, spellOutUmlauts)
        asciiFrom = end
    }
    return folded + text.slice(asciiFrom).toLowerCase()
}

export function foldCase(text: string): string {
    return foldedString(text, false)
}

export function foldCaseAndUmlauts(text: string): string {
    return foldedString(text, true)
}

/** Spells out each umlaut and keeps the case of every other character: `Größe` becomes `Groesse`. */
export function spellOutUmlauts(text: string): string {
    return text
        .normalize("NFC")
        .replace(UMLAUT_ANY_CASE, (umlaut) => UMLAUT_SPELLINGS_ANY_CASE[umlaut]!)
}

/** Returns true if a folded match may start or end at `offset`, false if the offset splits a character. */
export function isCharacterBoundary(folded: FoldedText, offset: number): boolean {
    if (offset === 0 || offset === folded.text.length) {
        return true
    }
    return folded.starts[offset] !== folded.starts[offset - 1]
}

/** Maps a non-empty folded range back to the original text. */
export function originalRange(folded: FoldedText, start: number, end: number): Range {
    assert(start < end, `folded range must not be empty, got [${start}, ${end})`)
    return { start: folded.starts[start]!, end: folded.ends[end - 1]! }
}

export function codePointLength(text: string, start = 0, end = text.length): number {
    let length = 0
    for (let index = start; index < end; index++) {
        if (!isLowSurrogateAfterHigh(text, index)) {
            length++
        }
    }
    return length
}

export function codePoints(text: string, start = 0, end = text.length): number[] {
    const points: number[] = []
    let index = start
    while (index < end) {
        const point = text.codePointAt(index)!
        points.push(point)
        index += point > 0xffff && index + 1 < end ? 2 : 1
    }
    return points
}

/** Writes the code points of `text` from `start` to `end` into `points` from index 0 and returns their count. Entries past the count stay as they were. */
export function codePointsInto(points: number[], text: string, start: number, end: number): number {
    let count = 0
    let index = start
    while (index < end) {
        const point = text.codePointAt(index)!
        points[count++] = point
        index += point > 0xffff && index + 1 < end ? 2 : 1
    }
    return count
}

function characterEnd(text: string, start: number): number {
    let end = start + codePointUnits(text, start)
    while (end < text.length && isCombiningMark(text, end)) {
        end += codePointUnits(text, end)
    }
    return end
}

function foldCharacter(text: string, start: number, end: number, spellOutUmlauts: boolean): string {
    const code = text.charCodeAt(start)
    if (end - start === 1 && code < 0x80) {
        return code >= 0x41 && code <= 0x5a ? String.fromCharCode(code + 0x20) : text[start]!
    }
    const character = text.slice(start, end)
    // Only a character with combining marks gets composed, since NFC maps some single characters to ASCII (U+037E to `;`).
    const hasMarks = end - start > codePointUnits(text, start)
    const lower = (hasMarks ? character.normalize("NFC") : character).toLowerCase()
    return spellOutUmlauts ? lower.replace(UMLAUT, (umlaut) => UMLAUT_SPELLINGS[umlaut]!) : lower
}

function isCombiningMark(text: string, index: number): boolean {
    if (text.charCodeAt(index) < 0x300) {
        return false
    }
    return COMBINING_MARK.test(String.fromCodePoint(text.codePointAt(index)!))
}

function codePointUnits(text: string, index: number): number {
    return isLowSurrogateAfterHigh(text, index + 1) ? 2 : 1
}

function isLowSurrogateAfterHigh(text: string, index: number): boolean {
    if (index === 0 || index >= text.length) {
        return false
    }
    const code = text.charCodeAt(index)
    const before = text.charCodeAt(index - 1)
    return code >= 0xdc00 && code <= 0xdfff && before >= 0xd800 && before <= 0xdbff
}
