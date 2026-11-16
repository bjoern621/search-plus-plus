import { describe, expect, it } from "vitest";
import { allowedEdits, compareWord, editDistance, foldCaseAndUmlauts } from "../../src/matching";

const points = (text: string) => Array.from(text, (character) => character.codePointAt(0)!);

describe("compareWord", () => {
  it("returns no reasons for an identical candidate", () => {
    expect(compareWord("Größe", "Größe", false)).toEqual({ reasons: [] });
    expect(compareWord("Größe", "Größe", true)).toEqual({ reasons: [] });
  });

  it("accepts only an identical candidate when exact", () => {
    expect(compareWord("Größe", "größe", true)).toBeUndefined();
    expect(compareWord("Größe", "Groesse", true)).toBeUndefined();
    expect(compareWord("gravite", "gravitee", true)).toBeUndefined();
  });

  it("reports a case difference", () => {
    expect(compareWord("Gravitee", "gravitee", false)).toEqual({
      reasons: [{ kind: "case", query: "Gravitee", found: "gravitee" }],
    });
  });

  it("reports umlaut spellings in both directions", () => {
    expect(compareWord("Größe", "Groesse", false)).toEqual({
      reasons: [{ kind: "umlaut", query: "Größe", found: "Groesse" }],
    });
    expect(compareWord("Groesse", "Größe", false)).toEqual({
      reasons: [{ kind: "umlaut", query: "Groesse", found: "Größe" }],
    });
    expect(compareWord("Grösse", "Größe", false)?.reasons[0]?.kind).toBe("umlaut");
    expect(compareWord("ÄÖÜ", "aeoeue", false)?.reasons[0]?.kind).toBe("umlaut");
    expect(compareWord("STRASSE", "Straße", false)?.reasons[0]?.kind).toBe("umlaut");
    expect(compareWord("STRAẞE", "strasse", false)?.reasons[0]?.kind).toBe("umlaut");
  });

  it("reports a close spelling with its edits", () => {
    expect(compareWord("Gravite", "gravitee", false)).toEqual({
      reasons: [{ kind: "fuzzy", query: "Gravite", found: "gravitee", edits: 1 }],
    });
    expect(compareWord("Gröse", "Größe", false)).toEqual({
      reasons: [{ kind: "fuzzy", query: "Gröse", found: "Größe", edits: 1 }],
    });
    expect(compareWord("Gröse", "Groesse", false)?.reasons[0]).toMatchObject({ kind: "fuzzy", edits: 1 });
  });

  it("rejects a candidate beyond the allowed edits", () => {
    expect(compareWord("ab", "ac", false)).toBeUndefined();
    expect(compareWord("abc", "axy", false)).toBeUndefined();
    expect(compareWord("gravitee", "grvtee", false)?.reasons[0]).toMatchObject({ edits: 2 });
    expect(compareWord("gravitee", "grvte", false)).toBeUndefined();
  });

  it("compares keys with characters outside words", () => {
    expect(compareWord("max-retries", "max_retries", false)?.reasons[0]).toMatchObject({ kind: "fuzzy", edits: 1 });
    expect(compareWord("my.key", "my.key", true)).toEqual({ reasons: [] });
  });
});

describe("allowedEdits", () => {
  it("follows the AUTO fuzziness of Elasticsearch", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 20].map(allowedEdits)).toEqual([0, 0, 0, 1, 1, 1, 2, 2, 2]);
  });
});

describe("editDistance", () => {
  it("counts inserts, deletes, replacements and swaps", () => {
    expect(editDistance(points("kitten"), points("sitting"), 5)).toBe(3);
    expect(editDistance(points("abcd"), points("abdc"), 5)).toBe(1);
    expect(editDistance(points(""), points("abc"), 5)).toBe(3);
  });

  it("edits no substring twice, as optimal string alignment does", () => {
    expect(editDistance(points("ca"), points("abc"), 5)).toBe(3);
  });

  it("stops at the maximum", () => {
    expect(editDistance(points("abcdef"), points("uvwxyz"), 2)).toBe(3);
    expect(editDistance(points("a"), points("abcdef"), 2)).toBe(3);
    expect(editDistance(points("same"), points("same"), 0)).toBe(0);
  });
});

describe("foldCaseAndUmlauts", () => {
  it("lowers case and spells umlauts out", () => {
    expect(foldCaseAndUmlauts("ÄÖÜäöüßẞ")).toBe("aeoeueaeoeuessss");
  });

  it("composes decomposed umlauts", () => {
    expect(foldCaseAndUmlauts("Größe")).toBe("groesse");
  });

  it("leaves a single character alone that NFC would map to ASCII", () => {
    expect(foldCaseAndUmlauts(";")).toBe(";");
  });
});
