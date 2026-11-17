import type { Range } from "../search/types"

export type RipgrepEvent =
    | { kind: "match"; path: string; line: number; ranges: Range[] }
    | { kind: "end"; path: string }
    | { kind: "other" }

interface RipgrepData {
    text?: string
    bytes?: string
}

interface RipgrepMessage {
    type: string
    data?: {
        path?: RipgrepData
        lines?: RipgrepData
        line_number?: number
        submatches?: { start: number; end: number }[]
    }
}

/**
 * Reads one line of `rg --json` output.
 * Lines and paths that are not valid UTF-8 reach ripgrep's output in base64 and stay out of the results.
 * `line` counts from 0. Ranges count UTF-16 code units, converted from ripgrep's byte offsets.
 */
export function parseRipgrepEvent(jsonLine: string): RipgrepEvent {
    const message = JSON.parse(jsonLine) as RipgrepMessage
    const path = message.data?.path?.text
    if (path === undefined) return { kind: "other" }
    if (message.type === "end") return { kind: "end", path }
    if (message.type !== "match") return { kind: "other" }
    const text = message.data?.lines?.text
    const lineNumber = message.data?.line_number
    if (text === undefined || lineNumber === undefined) return { kind: "other" }
    const submatches = message.data?.submatches ?? []
    const utf16Offsets = utf16OffsetsOf(
        text,
        submatches.flatMap((submatch) => [submatch.start, submatch.end])
    )
    const ranges = submatches.map((submatch) => ({
        start: utf16Offsets.get(submatch.start)!,
        end: utf16Offsets.get(submatch.end)!
    }))
    return { kind: "match", path, line: lineNumber - 1, ranges }
}

/**
 * Maps UTF-8 byte offsets into `text` to UTF-16 offsets in one pass over the text.
 * A byte offset inside a character maps to the end of that character.
 * A byte offset past the end maps to the length of the text.
 */
function utf16OffsetsOf(text: string, byteOffsets: number[]): Map<number, number> {
    const sorted = [...byteOffsets].sort((a, b) => a - b)
    const utf16Offsets = new Map<number, number>()
    let byteOffset = 0
    let utf16Offset = 0
    for (const wanted of sorted) {
        while (byteOffset < wanted && utf16Offset < text.length) {
            const codePoint = text.codePointAt(utf16Offset)!
            byteOffset += utf8Length(codePoint)
            utf16Offset += codePoint > 0xffff ? 2 : 1
        }
        utf16Offsets.set(wanted, utf16Offset)
    }
    return utf16Offsets
}

function utf8Length(codePoint: number): number {
    if (codePoint < 0x80) return 1
    if (codePoint < 0x800) return 2
    if (codePoint < 0x10000) return 3
    return 4
}

/**
 * Pulls the parser's message out of ripgrep's error output, such as "unclosed group".
 * Falls back to the last line of the output.
 */
export function regexErrorMessage(stderr: string): string {
    const lines = stderr
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== "")
    const error = lines.find((line) => line.startsWith("error:"))
    const message = error
        ? error.slice("error:".length)
        : (lines.at(-1) ?? "").replace(/^rg:\s*/, "")
    return message.trim().replace(/\.$/, "")
}
