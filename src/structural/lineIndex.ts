import type { Range } from "../search/types";

/** Maps offsets into a file text to lines, which end at `\n` or `\r\n` as the plain text engine splits them. */
export class LineIndex {
  /** Per line, the offset of its first character. */
  private readonly starts: number[] = [0];

  constructor(private readonly text: string) {
    for (let offset = text.indexOf("\n"); offset !== -1; offset = text.indexOf("\n", offset + 1)) {
      this.starts.push(offset + 1);
    }
  }

  /** The 0-based line that holds `offset`. An offset at a line break belongs to the line that it ends. */
  lineAt(offset: number): number {
    let low = 0;
    let high = this.starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (this.starts[middle]! <= offset) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    return low;
  }

  /**
   * Turns the file range from `start` to `end` into a range inside the line of `start`.
   * A range that runs past the end of that line stops there.
   */
  rangeInLine(line: number, start: number, end: number): Range {
    const lineStart = this.starts[line]!;
    const lineEnd = this.lineEnd(line);
    return { start: start - lineStart, end: Math.min(end, lineEnd) - lineStart };
  }

  /** The offset of the first line break character after `line`, or the text length on the last line. */
  private lineEnd(line: number): number {
    const next = this.starts[line + 1];
    if (next === undefined) {
      return this.text.length;
    }
    return this.text[next - 2] === "\r" ? next - 2 : next - 1;
  }
}
