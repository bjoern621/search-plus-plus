import { describe, expect, it } from "vitest";
import { parseRipgrepEvent, regexErrorMessage } from "../../src/engines/ripgrepJson";

describe("parseRipgrepEvent", () => {
  it("converts byte offsets after multi-byte characters into UTF-16 offsets", () => {
    const line = JSON.stringify({
      type: "match",
      data: { path: { text: "./t.txt" }, lines: { text: "ü 😀 4.1.0\n" }, line_number: 2, submatches: [{ match: { text: "4.1.0" }, start: 8, end: 13 }] },
    });
    expect(parseRipgrepEvent(line)).toEqual({ kind: "match", path: "./t.txt", line: 1, ranges: [{ start: 5, end: 10 }] });
  });

  it("reports the end of a file", () => {
    expect(parseRipgrepEvent(JSON.stringify({ type: "end", data: { path: { text: "./a" } } }))).toEqual({ kind: "end", path: "./a" });
  });

  it("skips lines that ripgrep sends as base64 bytes", () => {
    const line = JSON.stringify({ type: "match", data: { path: { text: "./a" }, lines: { bytes: "/w==" }, line_number: 1, submatches: [] } });
    expect(parseRipgrepEvent(line)).toEqual({ kind: "other" });
  });

  it("skips the summary", () => {
    expect(parseRipgrepEvent(JSON.stringify({ type: "summary", data: {} }))).toEqual({ kind: "other" });
  });
});

describe("regexErrorMessage", () => {
  it("keeps the parser's message alone", () => {
    const stderr = "rg: regex parse error:\n    (?:(?<=a)b)\n       ^^^^\nerror: look-around, including look-ahead and look-behind, is not supported\n\nConsider enabling PCRE2 with the --pcre2 flag.\n";
    expect(regexErrorMessage(stderr)).toBe("look-around, including look-ahead and look-behind, is not supported");
  });

  it("falls back to the last line", () => {
    expect(regexErrorMessage("rg: something broke.\n")).toBe("something broke");
  });
});
