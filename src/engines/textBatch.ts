import { assert } from "../search/assert";

/**
 * Joins texts into one input for a single ripgrep run and maps the line numbers of its output back to each text.
 * Each text ends in a line feed in the input, so no line spans two texts.
 */
export class TextBatch {
  readonly input: string;
  /** The 0-based line of the input that each text starts on. */
  private readonly starts: number[] = [];

  constructor(texts: readonly string[]) {
    const parts: string[] = [];
    let line = 0;
    for (const text of texts) {
      this.starts.push(line);
      const ended = text.endsWith("\n") ? text : `${text}\n`;
      parts.push(ended);
      line += lineFeedCount(ended);
    }
    this.input = parts.join("");
  }

  /** Maps a 0-based line of the input to the text that holds it and the 0-based line inside that text. */
  locate(inputLine: number): { text: number; line: number } {
    assert(inputLine >= 0, "a line of the input must not be negative");
    let low = 0;
    let high = this.starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if ((this.starts[middle] ?? 0) <= inputLine) low = middle;
      else high = middle - 1;
    }
    return { text: low, line: inputLine - (this.starts[low] ?? 0) };
  }
}

function lineFeedCount(text: string): number {
  let count = 0;
  for (let index = text.indexOf("\n"); index >= 0; index = text.indexOf("\n", index + 1)) count++;
  return count;
}
