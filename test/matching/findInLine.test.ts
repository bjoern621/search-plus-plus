import { describe, expect, it } from "vitest";
import { findInLine } from "../../src/matching";
import type { TextPiece } from "../../src/search/types";

const word = (value: string): TextPiece => ({ kind: "word", value, exact: false });
const exactWord = (value: string): TextPiece => ({ kind: "word", value, exact: true });
const literal = (value: string): TextPiece => ({ kind: "literal", value });
const wildcard: TextPiece = { kind: "wildcard" };

/** Pieces of `console.log(*)`. */
const consoleLogCall: TextPiece[] = [word("console"), literal("."), word("log"), literal("("), wildcard, literal(")")];

function found(line: string, pieces: TextPiece[]): string[] {
  return findInLine(line, pieces).map((match) => {
    expect(match.ranges).toHaveLength(1);
    return line.slice(match.ranges[0]!.start, match.ranges[0]!.end);
  });
}

describe("findInLine with one word", () => {
  it("finds a word inside a longer word", () => {
    expect(found("gravitee: true", [word("grav")])).toEqual(["grav"]);
    expect(found("useGravitee()", [word("grav")])).toEqual(["Grav"]);
  });

  it("finds a prefix as written before trying close spellings", () => {
    const matches = findInLine("gravitee", [word("gravite")]);
    expect(matches).toEqual([{ ranges: [{ start: 0, end: 7 }], reasons: [] }]);
  });

  it("finds Größe in every spelling", () => {
    const line = "Größe Groesse Grösse GROESSE";
    expect(found(line, [word("Größe")])).toEqual(["Größe", "Groesse", "Grösse", "GROESSE"]);
    expect(found(line, [word("Groesse")])).toEqual(["Größe", "Groesse", "Grösse", "GROESSE"]);
    expect(found(line, [word("Grösse")])).toEqual(["Größe", "Groesse", "Grösse", "GROESSE"]);
  });

  it("finds Größe and Groesse from the misspelling Gröse with one edit", () => {
    const matches = findInLine("Größe Groesse", [word("Gröse")]);
    expect(matches).toEqual([
      { ranges: [{ start: 0, end: 5 }], reasons: [{ kind: "fuzzy", query: "Gröse", found: "Größe", edits: 1 }] },
      { ranges: [{ start: 6, end: 13 }], reasons: [{ kind: "fuzzy", query: "Gröse", found: "Groesse", edits: 1 }] },
    ]);
  });

  it("reports case and umlaut reasons", () => {
    expect(findInLine("GRÖSSE", [word("größe")])[0]!.reasons).toEqual([
      { kind: "umlaut", query: "größe", found: "GRÖSSE" },
    ]);
    expect(findInLine("Größe", [word("größe")])[0]!.reasons).toEqual([
      { kind: "case", query: "größe", found: "Größe" },
    ]);
    expect(findInLine("Größe", [word("Größe")])[0]!.reasons).toEqual([]);
  });

  it("finds no umlaut by its first letter", () => {
    expect(found("Größe", [word("gro")])).toEqual([]);
    expect(found("Größe", [word("e")])).toEqual(["e"]);
    expect(findInLine("Größe", [word("e")])[0]!.ranges).toEqual([{ start: 4, end: 5 }]);
  });

  it("finds a decomposed umlaut and covers its combining mark", () => {
    const line = "Größe";
    expect(found(line, [word("Größe")])).toEqual([line]);
    expect(found(line, [word("groe")])).toEqual(["Grö"]);
  });

  it("finds an exact word as written alone", () => {
    expect(found("Größe Groesse größe Grösse", [exactWord("Größe")])).toEqual(["Größe"]);
    expect(found("Größenordnung", [exactWord("Größe")])).toEqual(["Größe"]);
  });

  it("allows no edit for words of one or two characters", () => {
    expect(found("ab ac", [word("ab")])).toEqual(["ab"]);
    expect(found("ac", [word("ab")])).toEqual([]);
  });

  it("finds close spellings of whole words and camelCase parts", () => {
    expect(found("gravitee", [word("gravitie")])).toEqual(["gravitee"]);
    expect(found("getGraviteeConfig", [word("gravitie")])).toEqual(["Gravitee"]);
    expect(found("HTTPServer", [word("servr")])).toEqual(["Server"]);
    expect(found("utf8Decoder", [word("decodr")])).toEqual(["Decoder"]);
  });

  it("finds no close spelling inside a part", () => {
    expect(found("Größenordnung", [word("Gröse")])).toEqual([]);
    expect(found("transport", [word("sport")])).toEqual(["sport"]);
    expect(found("transport", [word("spork")])).toEqual([]);
  });

  it("counts a swap of two neighbours as one edit", () => {
    expect(findInLine("receive", [word("recieve")])[0]!.reasons).toEqual([
      { kind: "fuzzy", query: "recieve", found: "receive", edits: 1 },
    ]);
  });

  it("returns non-overlapping matches from left to right", () => {
    expect(findInLine("aaaa", [word("aa")]).map((match) => match.ranges[0])).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });
});

describe("findInLine with several pieces", () => {
  it("matches console.log(*) whatever its arguments", () => {
    expect(found("console.log(res.status);", consoleLogCall)).toEqual(["console.log(res.status)"]);
    expect(found('  console.log("job", job.id)', consoleLogCall)).toEqual(['console.log("job", job.id)']);
    expect(found("console.log()", consoleLogCall)).toEqual(["console.log()"]);
  });

  it("ends a wildcard at the first closing piece", () => {
    expect(found("console.log(a); console.log(b);", consoleLogCall)).toEqual(["console.log(a)", "console.log(b)"]);
    expect(found("console.log(f(x))", consoleLogCall)).toEqual(["console.log(f(x)"]);
  });

  it("keeps a wildcard inside one line match", () => {
    expect(found("console.log(", consoleLogCall)).toEqual([]);
  });

  it("matches a close spelling inside a sequence", () => {
    const matches = findInLine("console.log(x)", [word("consle"), literal("."), word("log"), literal("("), wildcard, literal(")")]);
    expect(matches).toEqual([
      {
        ranges: [{ start: 0, end: 14 }],
        reasons: [{ kind: "fuzzy", query: "consle", found: "console", edits: 1 }],
      },
    ]);
  });

  it("finds a literal star", () => {
    const pieces = [word("import"), literal(" * "), word("as"), literal(" "), word("fs")];
    expect(found('import * as fs from "fs";', pieces)).toEqual(["import * as fs"]);
    expect(found('import fs from "fs";', pieces)).toEqual([]);
  });

  it("matches literals regardless of case", () => {
    expect(found("Content-Type: JSON", [literal("-type: json")])).toEqual(["-Type: JSON"]);
  });

  it("requires the pieces to touch without a wildcard between them", () => {
    expect(found("console . log", [word("console"), literal("."), word("log")])).toEqual([]);
  });

  it("backtracks over a wildcard until the rest matches", () => {
    expect(found("a(b a(x", [word("a"), wildcard, literal("("), word("x")])).toEqual(["a(b a(x"]);
    expect(found("ab ab", [word("a"), wildcard, word("b"), literal("!")])).toEqual([]);
  });
});

describe("findInLine edge cases", () => {
  it("matches nothing without pieces", () => {
    expect(findInLine("anything", [])).toEqual([]);
  });

  it("matches nothing with wildcards alone", () => {
    expect(findInLine("anything", [wildcard])).toEqual([]);
    expect(findInLine("anything", [wildcard, wildcard])).toEqual([]);
  });

  it("drops wildcards at the start and the end, since they match the empty run", () => {
    expect(found("x foo y", [wildcard, word("foo")])).toEqual(["foo"]);
    expect(found("x foo y", [word("foo"), wildcard])).toEqual(["foo"]);
    expect(found("x foo y", [wildcard, word("foo"), wildcard, wildcard])).toEqual(["foo"]);
  });

  it("matches nothing in an empty line", () => {
    expect(findInLine("", [word("foo")])).toEqual([]);
  });

  it("counts offsets in UTF-16 code units around surrogate pairs", () => {
    const line = "😀 Größe 😀 groesse";
    const matches = findInLine(line, [word("größe")]);
    expect(matches.map((match) => match.ranges[0])).toEqual([
      { start: 3, end: 8 },
      { start: 12, end: 19 },
    ]);
  });

  it("counts edits in code points for letters outside the Basic Multilingual Plane", () => {
    expect(found("𝐀𝐁𝐃", [word("𝐀𝐁𝐂")])).toEqual(["𝐀𝐁𝐃"]);
  });

  it("finds an emoji literal", () => {
    expect(found("a😀b", [literal("😀")])).toEqual(["😀"]);
  });

  it("rejects an empty word piece", () => {
    expect(() => findInLine("x", [word("")])).toThrow("a word piece must not be empty");
  });

  it("caches compiled pieces without mixing up two queries", () => {
    expect(found("foo bar", [word("foo")])).toEqual(["foo"]);
    expect(found("foo bar", [word("bar")])).toEqual(["bar"]);
  });
});
