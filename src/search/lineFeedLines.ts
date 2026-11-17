import type { LineMatch, Range } from "./types"

const LONE_CARRIAGE_RETURN = /\r(?!\n)/

/**
 * Maps lines as ripgrep counts them to lines as VS Code counts them.
 * ripgrep ends a line at `\n` alone. VS Code ends one at a lone `\r` as well.
 * For example, ripgrep reads `a\rb\nc` as the lines `a\rb` and `c`, VS Code as `a`, `b` and `c`.
 */
export class LineFeedLineMap {
    /** Per line-feed line, the editor line that it starts on. Empty for a text without a lone `\r`, where both counts agree. */
    private readonly firstLines: number[] = []
    /** Per line-feed line, the offsets inside it where a lone `\r` starts the next editor line. */
    private readonly breaks: number[][] = []
    /** Per line-feed line, the offset of its line ending. */
    private readonly ends: number[] = []

    constructor(text: string) {
        if (!LONE_CARRIAGE_RETURN.test(text)) return
        const lines = text.split("\n")
        let editorLine = 0
        lines.forEach((line, index) => {
            // A `\r` that a `\n` follows ends the line together with it.
            const end =
                index < lines.length - 1 && line.endsWith("\r") ? line.length - 1 : line.length
            const breaks: number[] = []
            for (let at = line.indexOf("\r"); at >= 0 && at < end; at = line.indexOf("\r", at + 1))
                breaks.push(at + 1)
            this.firstLines.push(editorLine)
            this.breaks.push(breaks)
            this.ends.push(end)
            editorLine += 1 + breaks.length
        })
    }

    /**
     * Moves each match to the editor line that holds its ranges.
     * A match whose ranges lie on several editor lines splits into one match per line. A range that runs past its editor line stops there.
     * Drops a match on a line that the text lacks, such as one from a file that changed after ripgrep read it.
     */
    toEditorLines(matches: readonly LineMatch[]): LineMatch[] {
        if (this.firstLines.length === 0) return [...matches]
        return matches.flatMap((match) => {
            const first = this.firstLines[match.line]
            const breaks = this.breaks[match.line]
            const end = this.ends[match.line]
            if (first === undefined || breaks === undefined || end === undefined) return []
            if (breaks.length === 0 || match.ranges.length === 0) return [{ ...match, line: first }]
            const byLine = new Map<number, Range[]>()
            for (const range of match.ranges) {
                const part = breaks.filter((start) => start <= range.start).length
                const partStart = breaks[part - 1] ?? 0
                const partEnd = part < breaks.length ? breaks[part]! - 1 : end
                const ranges = byLine.get(first + part) ?? []
                ranges.push({
                    start: range.start - partStart,
                    end: Math.min(range.end, partEnd) - partStart
                })
                byLine.set(first + part, ranges)
            }
            return [...byLine].map(([line, ranges]) => ({ ...match, line, ranges }))
        })
    }

    /** The editor lines that a line-feed line covers. Empty for a line that the text lacks. */
    editorLines(lineFeedLine: number): number[] {
        if (this.firstLines.length === 0) return [lineFeedLine]
        const first = this.firstLines[lineFeedLine]
        const breaks = this.breaks[lineFeedLine]
        if (first === undefined || breaks === undefined) return []
        return Array.from({ length: breaks.length + 1 }, (_, part) => first + part)
    }
}
