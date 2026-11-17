import type { FileResult, ResultLine } from "../messages"
import { assert } from "./assert"
import { LINE_EXCERPT_LEAD_CHARS, LINE_EXCERPT_LENGTH_CHARS } from "./config"
import type { LineMatch, Range } from "./types"

export interface LineSpan {
    /** 0-based, inclusive. */
    start: number
    /** 0-based, inclusive. */
    end: number
}

export interface ResultPlace {
    rootIndex: number
    root: string
    uri: string
    relativePath: string
    languageId: string
}

/** The line endings that VS Code ends a line at: `\r\n`, `\n` and a lone `\r`. */
export const LINE_BREAK = /\r\n|\r|\n/g

/**
 * Splits a text into lines as VS Code counts them, at every `LINE_BREAK`.
 * A final line ending starts no empty line.
 */
export function splitLines(text: string): string[] {
    const lines = text.split(LINE_BREAK)
    if (lines.length > 1 && lines.at(-1) === "") lines.pop()
    return lines
}

/**
 * Builds the view model of one file: its matched lines framed by context lines.
 * Asserts that `matches` come in ascending order and lie inside the file.
 */
export function buildFileResult(
    place: ResultPlace,
    lines: readonly string[],
    matches: readonly LineMatch[],
    contextLines: number
): FileResult {
    const byLine = new Map(matches.map((match) => [match.line, match]))
    const spans = contextSpans(
        matches.map((match) => match.line),
        lines.length,
        contextLines
    )
    const blocks = spans.map((span) => {
        const block: ResultLine[] = []
        for (let line = span.start; line <= span.end; line++) {
            block.push(resultLine(line, lines[line] ?? "", byLine.get(line)))
        }
        return block
    })
    const slash = place.relativePath.lastIndexOf("/")
    return {
        uri: place.uri,
        rootIndex: place.rootIndex,
        root: place.root,
        folder: slash < 0 ? "" : place.relativePath.slice(0, slash),
        name: place.relativePath.slice(slash + 1),
        languageId: place.languageId,
        matchCount: matches.length,
        blocks
    }
}

/**
 * Frames each matched line with `contextLines` lines before and after it.
 * Spans that overlap or touch join into one, so context of close matches shows once.
 */
export function contextSpans(
    matchLines: readonly number[],
    lineCount: number,
    contextLines: number
): LineSpan[] {
    assert(contextLines >= 0, "context lines must not be negative")
    const spans: LineSpan[] = []
    let previous = -1
    for (const line of matchLines) {
        assert(line > previous, "matched lines must come in ascending order without repeats")
        assert(
            line < lineCount,
            `matched line ${line} must lie inside the file of ${lineCount} lines`
        )
        previous = line
        const span = {
            start: Math.max(0, line - contextLines),
            end: Math.min(lineCount - 1, line + contextLines)
        }
        const last = spans.at(-1)
        if (last && span.start <= last.end + 1) {
            last.end = span.end
            continue
        }
        spans.push(span)
    }
    return spans
}

function resultLine(line: number, text: string, match: LineMatch | undefined): ResultLine {
    const ranges = match?.ranges ?? []
    const offset = excerptOffset(text, ranges)
    const result: ResultLine = {
        line,
        text: text.slice(offset, offset + LINE_EXCERPT_LENGTH_CHARS),
        offset,
        match: match !== undefined,
        ranges
    }
    if (match && match.reasons.length > 0) result.reasons = match.reasons
    if (match?.keyPath) result.keyPath = match.keyPath
    if (match?.keyPath && match.showKeyPath) result.showKeyPath = true
    return result
}

/** A long line starts its excerpt shortly before its first match, so the match stays in view. */
function excerptOffset(text: string, ranges: readonly Range[]): number {
    if (text.length <= LINE_EXCERPT_LENGTH_CHARS) return 0
    const first = ranges[0]
    if (!first) return 0
    return Math.max(
        0,
        Math.min(first.start - LINE_EXCERPT_LEAD_CHARS, text.length - LINE_EXCERPT_LENGTH_CHARS)
    )
}
