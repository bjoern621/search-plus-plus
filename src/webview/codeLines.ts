import type { ResultLine } from "../messages";
import type { Row } from "./tree";

/** Columns from one tab stop to the next, as `tab-size` on `.line` in main.css. */
const TAB_SIZE_COLUMNS = 4;

/** Counts the indentation of a line in columns. Undefined for a blank line and for an excerpt that starts inside its line. */
export function indentColumns(line: ResultLine): number | undefined {
  if (line.offset > 0) return undefined;
  let columns = 0;
  for (const char of line.text) {
    if (char === " ") columns++;
    else if (char === "\t") columns += TAB_SIZE_COLUMNS - (columns % TAB_SIZE_COLUMNS);
    else return columns;
  }
  return undefined;
}

/**
 * Finds the columns to remove from each row, so the least indented line of a block starts at the left edge.
 * A block runs over code lines of one file that follow each other without a gap, meaning a match with its context.
 * Every line of a block loses the same columns, so the lines keep their indentation relative to each other.
 */
export function blockDedents(rows: readonly Row[]): number[] {
  const dedents = rows.map(() => 0);
  let start = 0;
  while (start < rows.length) {
    if (rows[start]?.kind !== "line") {
      start++;
      continue;
    }
    let end = start + 1;
    while (end < rows.length && continuesBlock(rows[end - 1], rows[end])) end++;
    let smallest = Infinity;
    for (let index = start; index < end; index++) {
      const row = rows[index];
      const indent = row?.kind === "line" ? indentColumns(row.line) : undefined;
      if (indent !== undefined) smallest = Math.min(smallest, indent);
    }
    if (Number.isFinite(smallest)) dedents.fill(smallest, start, end);
    start = end;
  }
  return dedents;
}

function continuesBlock(above: Row | undefined, row: Row | undefined): boolean {
  return above?.kind === "line" && row?.kind === "line" && above.file === row.file && row.line.line === above.line.line + 1;
}

/** Removes `columns` of indentation and writes the rest of it as spaces, so tabs keep their width. The ranges keep pointing at the same text. */
export function dedent(line: ResultLine, columns: number): ResultLine {
  const indent = indentColumns(line);
  if (indent === undefined || columns === 0) return line;
  const leading = /^[ \t]*/.exec(line.text)?.[0].length ?? 0;
  const kept = Math.max(0, indent - columns);
  return { ...line, text: " ".repeat(kept) + line.text.slice(leading), offset: line.offset + leading - kept };
}

/**
 * Cuts the start of a match line whose first match would end past the right edge of its row.
 * The line keeps its indentation, then `…`, then the text from a word boundary about a third of the row before the match.
 * The indentation always stays, so the line lines up with the other lines of its block.
 * Returns undefined for a line whose match fits in `fitsChars` characters.
 */
export function cutToMatch(line: ResultLine, fitsChars: number): ResultLine | undefined {
  const first = line.ranges[0];
  if (!first) return undefined;
  const matchStart = first.start - line.offset;
  const matchEnd = first.end - line.offset;
  if (matchEnd <= fitsChars || matchStart <= 0) return undefined;
  const indent = /^ */.exec(line.text)?.[0].length ?? 0;
  const from = cutAt(line.text, matchStart, indent, fitsChars);
  if (from <= indent) return undefined;
  return { ...line, text: `${" ".repeat(indent)}…${line.text.slice(from)}`, offset: line.offset + from - indent - 1 };
}

/** The offset where the kept text starts: a word boundary at most a third of the row before the match. */
function cutAt(text: string, matchStart: number, indent: number, fitsChars: number): number {
  const lead = Math.max(0, Math.floor(fitsChars / 3) - indent - 1);
  for (let at = Math.max(indent + 1, matchStart - lead); at < matchStart; at++) {
    if (!isWordChar(text[at - 1]) || !isWordChar(text[at])) return at;
  }
  return matchStart;
}

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[\p{L}\p{N}_]/u.test(char);
}
