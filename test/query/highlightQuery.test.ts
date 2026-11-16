import { describe, expect, it } from "vitest";
import { highlightQuery } from "../../src/query/highlightQuery";

/** One letter per UTF-16 code unit: o for operator, e for escape, t for text. */
function roles(raw: string): string {
  const spans = highlightQuery(raw);
  let offset = 0;
  let out = "";
  for (const span of spans) {
    expect(span.range.start).toBe(offset);
    out += { operator: "o", escape: "e", text: "t" }[span.kind].repeat(span.range.end - span.range.start);
    offset = span.range.end;
  }
  expect(offset).toBe(raw.length);
  return out;
}

describe("highlightQuery: examples from DESIGN.md", () => {
  it("shows the quotes around a word as operators", () => {
    expect(roles('"hello"')).toBe("ottttto");
  });

  it("dims escaping backslashes and shows escaped quotes as text", () => {
    expect(roles('\\"hello\\"')).toBe("ettttttet");
  });

  it("shows the slashes, metacharacters and backslash letters of a regex as operators", () => {
    expect(roles("/4\\.\\d+\\.\\d+/")).toBe("otetoooetoooo");
  });

  it("shows a group with its comma and a globstar as operators", () => {
    expect(roles("**.{requests,limits}.memory")).toBe("oot" + "o" + "tttttttt" + "o" + "tttttt" + "o" + "ttttttt");
  });

  it("shows the brackets, negation and range dash of a class as operators", () => {
    expect(roles("v[!0-9]*")).toBe("toototoo");
  });
});

describe("highlightQuery: text queries", () => {
  it("returns no spans for an empty query", () => {
    expect(highlightQuery("")).toEqual([]);
  });

  it("merges neighbouring characters of one role into one span", () => {
    expect(highlightQuery("abc*?")).toEqual([
      { kind: "text", range: { start: 0, end: 3 } },
      { kind: "operator", range: { start: 3, end: 5 } },
    ]);
  });

  it("shows a comma outside braces as text", () => {
    expect(roles("a,b{c,d}")).toBe("tttototo");
  });

  it("shows operators inside quotes as text", () => {
    expect(roles('"a*{b}"')).toBe("o" + "ttttt" + "o");
  });

  it("shows an escape inside quotes as escape", () => {
    expect(roles('"a\\"b"')).toBe("o" + "t" + "e" + "tt" + "o");
  });

  it("shows a - at either end of a class and after a range as text", () => {
    expect(roles("[-a]")).toBe("otto");
    expect(roles("[a-]")).toBe("otto");
    expect(roles("[a-c-e]")).toBe("o" + "t" + "o" + "ttt" + "o");
  });

  it("shows ! alone in brackets as text", () => {
    expect(roles("[!]")).toBe("oto");
  });

  it("shows ! after the first item of a class as text", () => {
    expect(roles("[a!]")).toBe("otto");
  });

  it("shows operators inside a class as text", () => {
    expect(roles("[*{,]")).toBe("o" + "ttt" + "o");
  });

  it("shows an escaped class atom as escape and text", () => {
    expect(roles("[\\]-a]")).toBe("oetoto");
  });

  it("shows a trailing backslash as text", () => {
    expect(roles("a\\")).toBe("tt");
  });

  it("shows a lone closing bracket as an operator", () => {
    expect(roles("a]")).toBe("to");
  });

  it("covers characters outside the BMP with two code units", () => {
    expect(roles("😀*")).toBe("tto");
    expect(roles("\\😀")).toBe("ett");
  });

  it("highlights a query with a leading slash and no closing one as text", () => {
    expect(roles("/a.b")).toBe("tttt");
  });
});

describe("highlightQuery: regex queries", () => {
  it("dims a backslash before a character other than a letter", () => {
    expect(roles("/a\\/b/")).toBe("otetto");
  });

  it("shows each metacharacter as an operator", () => {
    expect(roles("/(a|b)*?[c]{2}^$/")).toBe("oo" + "t" + "o" + "t" + "oooo" + "t" + "oo" + "t" + "oooo");
  });
});
