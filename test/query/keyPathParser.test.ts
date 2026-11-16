import { describe, expect, it } from "vitest";
import { parseKeyPath } from "../../src/query/keyPathParser";
import type { KeyPathPattern, QueryError } from "../../src/query/types";

function pattern(raw: string): KeyPathPattern {
  const parsed = parseKeyPath(raw);
  if ("error" in parsed) {
    throw new Error(`Expected ${raw} to parse, got: ${parsed.error.message}`);
  }
  return parsed.pattern;
}

function error(raw: string): QueryError {
  const parsed = parseKeyPath(raw);
  if (!("error" in parsed)) {
    throw new Error(`Expected ${raw} to break the grammar`);
  }
  return parsed.error;
}

const literal = (value: string) => ({ kind: "literal", value });
const key = (...pieces: object[]) => ({ kind: "key", pieces });

describe("parseKeyPath: path and segments", () => {
  it("splits the path at every dot", () => {
    expect(pattern("global.values.gravitee.enabled").segments).toEqual([key(literal("global")), key(literal("values")), key(literal("gravitee")), key(literal("enabled"))]);
  });

  it("reads ** alone between dots as a globstar", () => {
    expect(pattern("**.enabled").segments).toEqual([{ kind: "globstar" }, key(literal("enabled"))]);
    expect(pattern("a.**").segments).toEqual([key(literal("a")), { kind: "globstar" }]);
  });

  it("reads ** next to other pieces as two stars", () => {
    expect(pattern("a**").segments).toEqual([key(literal("a"), { kind: "star" }, { kind: "star" })]);
    expect(pattern("**a").segments).toEqual([key({ kind: "star" }, { kind: "star" }, literal("a"))]);
  });

  it("keeps spaces and commas outside groups as literals", () => {
    expect(pattern("a b,c").segments).toEqual([key(literal("a b,c"))]);
  });
});

describe("parseKeyPath: pieces", () => {
  it("reads * and ? as wildcards", () => {
    expect(pattern("v*?").segments).toEqual([key(literal("v"), { kind: "star" }, { kind: "question" })]);
  });

  it("merges escaped characters into the literal around them", () => {
    expect(pattern("app\\.kubernetes\\.io/name").segments).toEqual([key(literal("app.kubernetes.io/name"))]);
  });

  it("escapes every operator", () => {
    expect(pattern('\\*\\?\\[\\]\\{\\}\\"\\\\').segments).toEqual([key(literal('*?[]{}"\\'))]);
  });

  it("reads a quoted run as one quoted piece with its dots and operators", () => {
    expect(pattern('labels."app.kubernetes.io/name"').segments).toEqual([key(literal("labels")), key({ kind: "quoted", value: "app.kubernetes.io/name" })]);
    expect(pattern('"a.*"').segments).toEqual([key({ kind: "quoted", value: "a.*" })]);
  });

  it("resolves escapes inside quotes", () => {
    expect(pattern('"a\\"b"').segments).toEqual([key({ kind: "quoted", value: 'a"b' })]);
  });

  it("accepts empty quotes", () => {
    expect(pattern('""').segments).toEqual([key({ kind: "quoted", value: "" })]);
  });

  it("keeps a quoted piece apart from the literal beside it", () => {
    expect(pattern('a"b"c').segments).toEqual([key(literal("a"), { kind: "quoted", value: "b" }, literal("c"))]);
  });
});

describe("parseKeyPath: classes", () => {
  it("reads single characters and ranges", () => {
    expect(pattern("[ab0-9]").segments).toEqual([
      key({
        kind: "class",
        negated: false,
        items: [
          { from: "a", to: "a" },
          { from: "b", to: "b" },
          { from: "0", to: "9" },
        ],
      }),
    ]);
  });

  it("negates a class with a leading ! or ^", () => {
    expect(pattern("v[!0-9]*").segments).toEqual([key(literal("v"), { kind: "class", negated: true, items: [{ from: "0", to: "9" }] }, { kind: "star" })]);
    expect(pattern("[^a]").segments).toEqual([key({ kind: "class", negated: true, items: [{ from: "a", to: "a" }] })]);
  });

  it("reads ! alone in brackets as the character !", () => {
    expect(pattern("[!]").segments).toEqual([key({ kind: "class", negated: false, items: [{ from: "!", to: "!" }] })]);
  });

  it("reads a - at either end of a class as the character -", () => {
    expect(pattern("[-a]").segments).toEqual([key({ kind: "class", negated: false, items: [{ from: "-", to: "-" }, { from: "a", to: "a" }] })]);
    expect(pattern("[a-]").segments).toEqual([key({ kind: "class", negated: false, items: [{ from: "a", to: "a" }, { from: "-", to: "-" }] })]);
  });

  it("starts a new item after a range", () => {
    expect(pattern("[a-c-e]").segments).toEqual([
      key({
        kind: "class",
        negated: false,
        items: [
          { from: "a", to: "c" },
          { from: "-", to: "-" },
          { from: "e", to: "e" },
        ],
      }),
    ]);
  });

  it("reads operators other than ] and \\ inside a class as characters", () => {
    expect(pattern('[*?[{}",]').segments).toEqual([key({ kind: "class", negated: false, items: Array.from('*?[{}",').map((c) => ({ from: c, to: c })) })]);
  });

  it("accepts escapes as class atoms", () => {
    expect(pattern("[\\]\\.]").segments).toEqual([
      key({
        kind: "class",
        negated: false,
        items: [
          { from: "]", to: "]" },
          { from: ".", to: "." },
        ],
      }),
    ]);
  });
});

describe("parseKeyPath: groups", () => {
  it("reads alternatives between commas", () => {
    expect(pattern("values.{gateway,portal}.enabled").segments).toEqual([
      key(literal("values")),
      key({ kind: "group", alternatives: [[key(literal("gateway"))], [key(literal("portal"))]] }),
      key(literal("enabled")),
    ]);
  });

  it("lets an alternative span several keys", () => {
    expect(pattern("{gateway.enabled,portal}").segments).toEqual([
      key({ kind: "group", alternatives: [[key(literal("gateway")), key(literal("enabled"))], [key(literal("portal"))]] }),
    ]);
  });

  it("accepts globstars, wildcards, classes and quotes inside a group", () => {
    expect(pattern('{**.a,b*,[cd],"e.f"}').segments).toEqual([
      key({
        kind: "group",
        alternatives: [
          [{ kind: "globstar" }, key(literal("a"))],
          [key(literal("b"), { kind: "star" })],
          [key({ kind: "class", negated: false, items: [{ from: "c", to: "c" }, { from: "d", to: "d" }] })],
          [key({ kind: "quoted", value: "e.f" })],
        ],
      }),
    ]);
  });

  it("keeps a group inside a segment beside other pieces", () => {
    expect(pattern("a{b,c}d").segments).toEqual([key(literal("a"), { kind: "group", alternatives: [[key(literal("b"))], [key(literal("c"))]] }, literal("d"))]);
  });
});

describe("parseKeyPath: errors", () => {
  it("names a bracket left open", () => {
    expect(error("a[bc")).toEqual({ message: "The key path skips this query because a bracket ([) stays open. Close it with ].", range: { start: 1, end: 2 } });
  });

  it("names a dot inside brackets", () => {
    expect(error("a[b.c]")).toMatchObject({ message: expect.stringContaining("a dot (.) sits inside brackets"), range: { start: 3, end: 4 } });
  });

  it("names empty brackets", () => {
    expect(error("a[]")).toMatchObject({ message: expect.stringContaining("a pair of brackets ([]) holds no character"), range: { start: 1, end: 3 } });
  });

  it("names a range that runs backwards", () => {
    expect(error("[z-a]")).toEqual({ message: "The key path skips this query because the range z-a runs backwards. Write it as a-z.", range: { start: 1, end: 4 } });
  });

  it("names a closing bracket without an opening one", () => {
    expect(error("a]")).toMatchObject({ message: expect.stringContaining("a bracket (]) closes nothing"), range: { start: 1, end: 2 } });
  });

  it("names a brace left open", () => {
    expect(error("a.{b,c")).toEqual({ message: "The key path skips this query because a brace ({) stays open. Close it with }.", range: { start: 2, end: 3 } });
    expect(error("{")).toMatchObject({ range: { start: 0, end: 1 } });
  });

  it("names a closing brace without an opening one", () => {
    expect(error("a}")).toMatchObject({ message: expect.stringContaining("a brace (}) closes nothing"), range: { start: 1, end: 2 } });
  });

  it("names a group inside a group", () => {
    expect(error("{a,{b}}")).toMatchObject({ message: expect.stringContaining("groups cannot nest"), range: { start: 3, end: 4 } });
  });

  it("names an empty group and an empty alternative", () => {
    expect(error("a{}")).toMatchObject({ message: expect.stringContaining("a group ({}) holds nothing"), range: { start: 2, end: 3 } });
    expect(error("{a,}")).toMatchObject({ message: expect.stringContaining("a group ({}) leaves a key empty"), range: { start: 3, end: 4 } });
    expect(error("{,a}")).toMatchObject({ range: { start: 1, end: 2 } });
    expect(error("{a.,b}")).toMatchObject({ range: { start: 3, end: 4 } });
  });

  it("names a quote left open", () => {
    expect(error('a."b.c')).toEqual({ message: 'The key path skips this query because a quote (") stays open. Close it with ".', range: { start: 2, end: 3 } });
  });

  it("names a trailing backslash", () => {
    expect(error("a\\")).toMatchObject({ message: expect.stringContaining("it ends with a backslash"), range: { start: 1, end: 2 } });
    expect(error('"a\\')).toMatchObject({ range: { start: 2, end: 3 } });
    expect(error("[a\\")).toMatchObject({ range: { start: 2, end: 3 } });
  });

  it("names a leading dot, a trailing dot and two dots in a row", () => {
    expect(error(".Values.global")).toMatchObject({ message: expect.stringContaining("it starts with a dot"), range: { start: 0, end: 1 } });
    expect(error("global.")).toMatchObject({ message: expect.stringContaining("it ends with a dot"), range: { start: 6, end: 7 } });
    expect(error("a..b")).toMatchObject({ message: expect.stringContaining("two dots (..)"), range: { start: 2, end: 3 } });
  });

  it("names an empty query", () => {
    expect(error("")).toMatchObject({ range: { start: 0, end: 0 } });
  });

  it("reports the first break from the left", () => {
    expect(error("a]{")).toMatchObject({ range: { start: 1, end: 2 } });
  });

  it("counts offsets in UTF-16 code units", () => {
    expect(error("😀[")).toMatchObject({ range: { start: 2, end: 3 } });
  });
});
