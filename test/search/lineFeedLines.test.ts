import { describe, expect, it } from "vitest";
import { LineFeedLineMap } from "../../src/search/lineFeedLines";

describe("LineFeedLineMap", () => {
  const lines = new LineFeedLineMap("ab\rcd\r\nef\n");

  it("splits a match at a lone carriage return and keeps CRLF as one line ending", () => {
    const match = { line: 0, ranges: [{ start: 1, end: 4 }, { start: 4, end: 6 }], reasons: [] };
    expect(lines.toEditorLines([match, { line: 1, ranges: [{ start: 0, end: 2 }], reasons: [] }])).toEqual([
      { line: 0, ranges: [{ start: 1, end: 2 }], reasons: [] },
      { line: 1, ranges: [{ start: 1, end: 2 }], reasons: [] },
      { line: 2, ranges: [{ start: 0, end: 2 }], reasons: [] },
    ]);
  });

  it("names the editor lines of a line-feed line and drops a line that the text lacks", () => {
    expect([0, 1, 5].map((line) => lines.editorLines(line))).toEqual([[0, 1], [2], []]);
    expect(lines.toEditorLines([{ line: 5, ranges: [], reasons: [] }])).toEqual([]);
  });

  it("keeps the lines of a text without a lone carriage return", () => {
    const match = { line: 1, ranges: [{ start: 0, end: 1 }], reasons: [] };
    expect(new LineFeedLineMap("a\r\nb\n").toEditorLines([match])).toEqual([match]);
  });
});
