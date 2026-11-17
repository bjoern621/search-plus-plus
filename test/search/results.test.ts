import { describe, expect, it } from "vitest";
import { LINE_EXCERPT_LEAD_CHARS, LINE_EXCERPT_LENGTH_CHARS } from "../../src/search/config";
import { buildFileResult, contextSpans, excerptLines, splitLines } from "../../src/search/results";

const place = { rootIndex: 0, root: "", uri: "file:///w/charts/apim/values.yaml", relativePath: "charts/apim/values.yaml", languageId: "yaml" };

describe("contextSpans", () => {
  it("frames each match with context lines and clips at the file edges", () => {
    expect(contextSpans([0, 9], 10, 1)).toEqual([
      { start: 0, end: 1 },
      { start: 8, end: 9 },
    ]);
  });

  it("joins the context of close matches into one span", () => {
    expect(contextSpans([2, 4, 9], 20, 1)).toEqual([
      { start: 1, end: 5 },
      { start: 8, end: 10 },
    ]);
  });

  it("joins spans that touch without overlapping", () => {
    expect(contextSpans([1, 4], 10, 1)).toEqual([{ start: 0, end: 5 }]);
  });

  it("shows matched lines alone with zero context lines", () => {
    expect(contextSpans([3, 4], 10, 0)).toEqual([{ start: 3, end: 4 }]);
  });

  it("rejects a match past the last line", () => {
    expect(() => contextSpans([10], 10, 1)).toThrow(/inside the file/);
  });
});

describe("buildFileResult", () => {
  it("splits the path into folder and name and marks context lines", () => {
    const lines = splitLines("gravitee:\n  enabled: true\n  gateway:\n");
    const result = buildFileResult(place, lines, [{ line: 1, ranges: [{ start: 2, end: 9 }], reasons: [] }], 1);
    expect(result.folder).toBe("charts/apim");
    expect(result.name).toBe("values.yaml");
    expect(result.matchCount).toBe(1);
    expect(result.blocks).toEqual([
      [
        { line: 0, text: "gravitee:", offset: 0, match: false, ranges: [] },
        { line: 1, text: "  enabled: true", offset: 0, match: true, ranges: [{ start: 2, end: 9 }] },
        { line: 2, text: "  gateway:", offset: 0, match: false, ranges: [] },
      ],
    ]);
  });

  it("hands the reasons and the key path of a match to its line", () => {
    const reasons = [{ kind: "fuzzy" as const, query: "enabeld", found: "enabled", edits: 1 }];
    const result = buildFileResult(place, ["gravitee:", "  enabled: true"], [{ line: 1, ranges: [{ start: 2, end: 9 }], reasons, keyPath: ["gravitee", "enabled"] }], 1);
    expect(result.blocks[0]?.[1]).toMatchObject({ reasons, keyPath: ["gravitee", "enabled"] });
    expect(result.blocks[0]?.[0]).not.toHaveProperty("reasons");
  });

  it("starts the excerpt of a long line shortly before its first match", () => {
    const long = `${"x".repeat(1000)}needle${"y".repeat(1000)}`;
    const result = buildFileResult(place, [long], [{ line: 0, ranges: [{ start: 1000, end: 1006 }], reasons: [] }], 0);
    const line = result.blocks[0]?.[0];
    expect(line?.offset).toBe(1000 - LINE_EXCERPT_LEAD_CHARS);
    expect(line?.text.length).toBe(LINE_EXCERPT_LENGTH_CHARS);
    expect(line?.text.slice(LINE_EXCERPT_LEAD_CHARS, LINE_EXCERPT_LEAD_CHARS + 6)).toBe("needle");
  });

  it("puts a file at the root into the empty folder", () => {
    const result = buildFileResult({ ...place, relativePath: "README.md" }, ["a"], [{ line: 0, ranges: [], reasons: [] }], 1);
    expect(result.folder).toBe("");
    expect(result.name).toBe("README.md");
  });
});

describe("splitLines", () => {
  it("ends lines at LF and at CRLF", () => {
    expect(splitLines("a\r\nb\nc")).toEqual(["a", "b", "c"]);
  });

  it("starts no empty line after a final line ending", () => {
    expect(splitLines("a\n")).toEqual(["a"]);
    expect(splitLines("a\n\n")).toEqual(["a", ""]);
    expect(splitLines("")).toEqual([""]);
  });
});

describe("excerptLines", () => {
  it("frames the center line and clips at the file edges", () => {
    const lines = ["a", "b", "c", "d"];
    expect(excerptLines(lines, 1, 2).map((line) => [line.line, line.text, line.match])).toEqual([
      [0, "a", false],
      [1, "b", false],
      [2, "c", false],
      [3, "d", false],
    ]);
    expect(excerptLines(lines, 3, 1).map((line) => line.line)).toEqual([2, 3]);
  });
});
