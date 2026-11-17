import { describe, expect, it } from "vitest";
import { LineIndex } from "../../src/structural/lineIndex";

describe("LineIndex", () => {
  it("ends lines at LF, at CRLF and at a lone CR, as VS Code does", () => {
    const text = "a\rbb\r\nc\nd";
    const lines = new LineIndex(text);
    expect([..."abcd"].map((char) => lines.lineAt(text.indexOf(char)))).toEqual([0, 1, 2, 3]);
    expect(lines.rangeInLine(1, text.indexOf("bb"), text.length)).toEqual({ start: 0, end: 2 });
    expect(lines.rangeInLine(0, 0, text.length)).toEqual({ start: 0, end: 1 });
  });
});
