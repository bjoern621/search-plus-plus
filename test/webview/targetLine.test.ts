import { describe, expect, it } from "vitest";
import type { FileResult, ResultLine } from "../../src/messages";
import { targetLine } from "../../src/webview/codeLines";

const line = (number: number, match: boolean): ResultLine => ({ line: number, text: `line ${number}`, offset: 0, match, ranges: match ? [{ start: 0, end: 4 }] : [] });

describe("targetLine", () => {
  const above = line(4, false);
  const matched = line(5, true);
  const below = line(6, false);
  const file = { blocks: [[above, matched, below]] } as unknown as FileResult;

  it("opens the matched line from every line of its block", () => {
    expect(targetLine(file, above)).toBe(matched);
    expect(targetLine(file, matched)).toBe(matched);
    expect(targetLine(file, below)).toBe(matched);
  });

  it("opens a line outside every block at the line itself", () => {
    const loose = line(9, false);
    expect(targetLine(file, loose)).toBe(loose);
  });
});
