import type { FileResult, ResultLine } from "../messages"
import type { Row } from "./tree"

/** Columns from one tab stop to the next, as `tab-size` on `.line` in main.css. */
const TAB_SIZE_COLUMNS = 4

/** Counts the indentation of a line in columns. Undefined for a blank line and for an excerpt that starts inside its line. */
export function indentColumns(line: ResultLine): number | undefined {
    if (line.offset > 0) return undefined
    let columns = 0
    for (const char of line.text) {
        if (char === " ") columns++
        else if (char === "\t") columns += TAB_SIZE_COLUMNS - (columns % TAB_SIZE_COLUMNS)
        else return columns
    }
    return undefined
}

/**
 * Tells whether `row` shows the line right below the line of `above` in the same file.
 * Such rows form one group: the rows of a result block between two lines that take no row, such as blank lines.
 * A divider separates two groups. Hover and selection outline one group.
 */
export function continuesGroup(above: Row | undefined, row: Row | undefined): boolean {
    return (
        above?.kind === "line" &&
        row?.kind === "line" &&
        above.file === row.file &&
        row.line.line === above.line.line + 1
    )
}

/** Finds the first and the last row of the group that holds the code line at `index`. */
export function groupAround(rows: readonly Row[], index: number): { first: number; last: number } {
    let first = index
    let last = index
    while (continuesGroup(rows[first - 1], rows[first])) first--
    while (continuesGroup(rows[last], rows[last + 1])) last++
    return { first, last }
}

/**
 * Finds the line that a click on the code line at `index` opens.
 * A matched line opens itself. A context line opens the first matched line of its group, else of its result block.
 * A context line outside every block, or in a block without a match, opens itself.
 */
export function targetLine(rows: readonly Row[], index: number): ResultLine | undefined {
    const row = rows[index]
    if (row?.kind !== "line") return undefined
    if (row.line.match) return row.line
    const group = groupAround(rows, index)
    for (let other = group.first; other <= group.last; other++) {
        const candidate = rows[other]
        if (candidate?.kind === "line" && candidate.line.match) return candidate.line
    }
    const block = row.file.blocks.find((lines) => lines.includes(row.line))
    return block?.find((line) => line.match) ?? row.line
}

/**
 * Finds the columns to remove from each row, to start the least indented line of a group at the left edge.
 * Every line of a group loses the same columns. The lines keep their indentation relative to each other.
 */
export function groupDedents(rows: readonly Row[]): number[] {
    const dedents = rows.map(() => 0)
    let start = 0
    while (start < rows.length) {
        if (rows[start]?.kind !== "line") {
            start++
            continue
        }
        let end = start + 1
        while (end < rows.length && continuesGroup(rows[end - 1], rows[end])) end++
        let smallest = Infinity
        for (let index = start; index < end; index++) {
            const row = rows[index]
            const indent = row?.kind === "line" ? indentColumns(row.line) : undefined
            if (indent !== undefined) smallest = Math.min(smallest, indent)
        }
        if (Number.isFinite(smallest)) dedents.fill(smallest, start, end)
        start = end
    }
    return dedents
}

/** Removes `columns` of indentation and writes the rest of it as spaces, so tabs keep their width. The ranges keep pointing at the same text. */
export function dedent(line: ResultLine, columns: number): ResultLine {
    const indent = indentColumns(line)
    if (indent === undefined || columns === 0) return line
    const leading = /^[ \t]*/.exec(line.text)?.[0].length ?? 0
    const kept = Math.max(0, indent - columns)
    return {
        ...line,
        text: " ".repeat(kept) + line.text.slice(leading),
        offset: line.offset + leading - kept
    }
}

/**
 * Cuts the start of a match line whose first match would end past the right edge of its row.
 * The line keeps its indentation, then the text from a word boundary about a third of the row before the match.
 * The indentation always stays, so the line lines up with the other lines of its group. The caller marks the cut outside the text.
 * Returns undefined for a line whose match fits in `fitsChars` characters.
 */
export function cutToMatch(line: ResultLine, fitsChars: number): ResultLine | undefined {
    const first = line.ranges[0]
    if (!first) return undefined
    const matchStart = first.start - line.offset
    const matchEnd = first.end - line.offset
    if (matchEnd <= fitsChars || matchStart <= 0) return undefined
    const indent = /^ */.exec(line.text)?.[0].length ?? 0
    const from = cutAt(line.text, matchStart, indent, fitsChars)
    if (from <= indent) return undefined
    return {
        ...line,
        text: " ".repeat(indent) + line.text.slice(from),
        offset: line.offset + from - indent
    }
}

/** The offset where the kept text starts: a word boundary at most a third of the row before the match. */
function cutAt(text: string, matchStart: number, indent: number, fitsChars: number): number {
    const lead = Math.max(0, Math.floor(fitsChars / 3) - indent - 1)
    for (let at = Math.max(indent + 1, matchStart - lead); at < matchStart; at++) {
        if (!isWordChar(text[at - 1]) || !isWordChar(text[at])) return at
    }
    return matchStart
}

function isWordChar(char: string | undefined): boolean {
    return char !== undefined && /[\p{L}\p{N}_]/u.test(char)
}
