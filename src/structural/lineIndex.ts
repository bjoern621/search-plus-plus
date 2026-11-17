import { LINE_BREAK } from "../search/results";
import type { Range } from "../search/types";

/** Maps offsets into a file text to lines, which end at every `LINE_BREAK` as `splitLines` splits them. */
export class LineIndex {
  /** Per line, the offset of its first character. */
  private readonly starts: number[] = [0];
  /** Per line, the offset of its line break, or the text length on the last line. */
  private readonly ends: number[] = [];

  constructor(text: string) {
    for (const lineBreak of text.matchAll(LINE_BREAK)) {
      this.ends.push(lineBreak.index);
      this.starts.push(lineBreak.index + lineBreak[0].length);
    }
    this.ends.push(text.length);
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
    return { start: start - lineStart, end: Math.min(end, this.ends[line]!) - lineStart };
  }
}
