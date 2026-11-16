import { describe, expect, it, vi } from "vitest";
import { parseKeyPath } from "../../src/query/keyPathParser";
import { findInChain, matchKeyPath } from "../../src/query/matchKeyPath";
import type { CompareKey, KeyPathPattern } from "../../src/query/types";
import { fakeCompareKey } from "./fakeCompareKey";

function pattern(raw: string): KeyPathPattern {
  const parsed = parseKeyPath(raw);
  if ("error" in parsed) {
    throw new Error(`Expected ${raw} to parse, got: ${parsed.error.message}`);
  }
  return parsed.pattern;
}

function matches(raw: string, path: string): boolean {
  return matchKeyPath(pattern(raw), path.split("."), fakeCompareKey) !== undefined;
}

describe("matchKeyPath: examples from DESIGN.md", () => {
  it("finds enabled under gravitee under values under global, and nowhere else", () => {
    expect(matches("global.values.gravitee.enabled", "global.values.gravitee.enabled")).toBe(true);
    expect(matches("global.values.gravitee.enabled", "values.gravitee.enabled")).toBe(false);
    expect(matches("global.values.gravitee.enabled", "global.values.gravitee.enabled.x")).toBe(false);
    expect(matches("global.values.gravitee.enabled", "other.values.gravitee.enabled")).toBe(false);
  });

  it("matches one key with *", () => {
    expect(matches("values.*.enabled", "values.gateway.enabled")).toBe(true);
    expect(matches("values.*.enabled", "values.portal.enabled")).toBe(true);
    expect(matches("values.*.enabled", "values.a.b.enabled")).toBe(false);
  });

  it("matches the rest of a key with a trailing *", () => {
    expect(matches("values.grav*.enabled", "values.gravitee.enabled")).toBe(true);
    expect(matches("values.grav*.enabled", "values.portal.enabled")).toBe(false);
  });

  it("finds enabled at any depth with **", () => {
    expect(matches("**.enabled", "enabled")).toBe(true);
    expect(matches("**.enabled", "a.enabled")).toBe(true);
    expect(matches("**.enabled", "a.b.c.enabled")).toBe(true);
    expect(matches("**.enabled", "a.enabled.b")).toBe(false);
  });

  it("finds both toggles with a group and leaves out the others", () => {
    expect(matches("values.{gateway,portal}.enabled", "values.gateway.enabled")).toBe(true);
    expect(matches("values.{gateway,portal}.enabled", "values.portal.enabled")).toBe(true);
    expect(matches("values.{gateway,portal}.enabled", "values.ui.enabled")).toBe(false);
  });

  it("finds a sequence item by its index", () => {
    expect(matches("ingress.hosts.0", "ingress.hosts.0")).toBe(true);
    expect(matches("ingress.hosts.0", "ingress.hosts.1")).toBe(false);
  });

  it("finds a key holding dots through quotes or escapes", () => {
    const keys = ["metadata", "labels", "app.kubernetes.io/name"];
    expect(matchKeyPath(pattern('metadata.labels."app.kubernetes.io/name"'), keys, fakeCompareKey)).toBeDefined();
    expect(matchKeyPath(pattern("metadata.labels.app\\.kubernetes\\.io/name"), keys, fakeCompareKey)).toBeDefined();
  });

  it("finds a key a few edits away when the segment holds literals alone", () => {
    const match = matchKeyPath(pattern("Global.Values.Gravite.Enabled"), ["global", "values", "gravitee", "enabled"], fakeCompareKey);
    expect(match?.keys[2]).toEqual({ index: 2, reasons: [{ kind: "fuzzy", query: "Gravite", found: "gravitee", edits: 1 }] });
  });

  it("leaves out other spellings of a quoted key", () => {
    expect(matches('**."enabled"', "a.enabled")).toBe(true);
    expect(matches('**."enabled"', "a.enable")).toBe(false);
    expect(matches('**."enabled"', "a.Enabled")).toBe(false);
  });

  it("matches the quoted characters as written", () => {
    expect(matchKeyPath(pattern('"a.*"'), ["a.*"], fakeCompareKey)).toBeDefined();
    expect(matchKeyPath(pattern('"a.*"'), ["a.b"], fakeCompareKey)).toBeUndefined();
  });
});

describe("matchKeyPath: literals", () => {
  it("matches case-insensitively and with umlaut variants", () => {
    expect(matches("Enabled", "enabled")).toBe(true);
    expect(matches("Größe", "groesse")).toBe(true);
    expect(matches("Groesse", "größe")).toBe(true);
  });

  it("applies the matching defaults to a literal beside a wildcard, without fuzziness", () => {
    expect(matches("Grö*", "groesse")).toBe(true);
    expect(matches("gravitee*", "graviteex")).toBe(true);
    expect(matches("gravitea*", "graviteex")).toBe(false);
  });

  it("passes the whole key and fuzzy only for a segment of literals alone", () => {
    const compareKey = vi.fn<CompareKey>(fakeCompareKey);
    matchKeyPath(pattern("values.gr*"), ["values", "gravitee"], compareKey);
    expect(compareKey).toHaveBeenCalledWith("values", "values", { exact: false, fuzzy: true });
    expect(compareKey).toHaveBeenCalledWith("gr", "gr", { exact: false, fuzzy: false });
    expect(compareKey).not.toHaveBeenCalledWith("gr", expect.anything(), { exact: false, fuzzy: true });
  });

  it("passes exact for a quoted piece", () => {
    const compareKey = vi.fn<CompareKey>(fakeCompareKey);
    matchKeyPath(pattern('"a"'), ["a"], compareKey);
    expect(compareKey).toHaveBeenCalledWith("a", "a", { exact: true, fuzzy: false });
  });

  it("matches a quoted piece and a literal in one key", () => {
    expect(matches('Pre"Fix"', "preFix")).toBe(true);
    expect(matches('Pre"Fix"', "prefix")).toBe(false);
  });

  it("matches an empty quoted piece against an empty key", () => {
    expect(matchKeyPath(pattern('a.""'), ["a", ""], fakeCompareKey)).toBeDefined();
    expect(matchKeyPath(pattern('a.""'), ["a", "b"], fakeCompareKey)).toBeUndefined();
  });

  it("gives no fuzzy match to a literal inside a group", () => {
    expect(matches("{gatewy,portal}", "gateway")).toBe(false);
  });
});

describe("matchKeyPath: wildcards and classes", () => {
  it("matches zero characters with *", () => {
    expect(matches("grav*", "grav")).toBe(true);
    expect(matches("*", "x")).toBe(true);
  });

  it("matches one character with ?", () => {
    expect(matches("v?", "v1")).toBe(true);
    expect(matches("v?", "v")).toBe(false);
    expect(matches("v?", "v12")).toBe(false);
  });

  it("counts a character outside the BMP as one character", () => {
    expect(matches("?", "😀")).toBe(true);
    expect(matches("a*b", "a😀b")).toBe(true);
  });

  it("matches one character out of a class", () => {
    expect(matches("v[0-9]", "v1")).toBe(true);
    expect(matches("v[0-9]", "vx")).toBe(false);
    expect(matches("[ab]x", "bx")).toBe(true);
  });

  it("matches every character outside a negated class", () => {
    expect(matches("v[!0-9]*", "vx1")).toBe(true);
    expect(matches("v[!0-9]*", "v1x")).toBe(false);
    expect(matches("v[^0-9]*", "vx")).toBe(true);
  });

  it("ignores case in a class", () => {
    expect(matches("[a-z]", "Q")).toBe(true);
    expect(matches("[!a-z]", "Q")).toBe(false);
  });

  it("keeps * and ? inside one key", () => {
    expect(matches("a*", "ab.c")).toBe(false);
    expect(matches("a?c", "a.c")).toBe(false);
  });
});

describe("matchKeyPath: globstars", () => {
  it("matches every key path with ** alone", () => {
    expect(matches("**", "a")).toBe(true);
    expect(matches("**", "a.b.c")).toBe(true);
  });

  it("matches zero or more keys with a trailing **", () => {
    expect(matches("a.**", "a")).toBe(true);
    expect(matches("a.**", "a.b.c")).toBe(true);
    expect(matches("a.**", "b.c")).toBe(false);
  });

  it("matches zero or more keys with ** between two keys", () => {
    expect(matches("a.**.b", "a.b")).toBe(true);
    expect(matches("a.**.b", "a.x.y.b")).toBe(true);
    expect(matches("a.**.b", "a.x.y")).toBe(false);
  });

  it("treats several ** in a row as one", () => {
    expect(matches("a.**.**.b", "a.b")).toBe(true);
    expect(matches("**.**", "a")).toBe(true);
    expect(matches("**.**.b", "x.y.b")).toBe(true);
  });

  it("matches nothing for an empty key path", () => {
    expect(matchKeyPath(pattern("**"), [], fakeCompareKey)).toBeUndefined();
  });
});

describe("matchKeyPath: groups", () => {
  it("lets an alternative span several keys", () => {
    expect(matches("{gateway.enabled,portal}", "gateway.enabled")).toBe(true);
    expect(matches("{gateway.enabled,portal}", "portal")).toBe(true);
    expect(matches("{gateway.enabled,portal}", "gateway")).toBe(false);
    expect(matches("values.{gateway.enabled,portal}.x", "values.gateway.enabled.x")).toBe(true);
  });

  it("glues an alternative to the characters around the group", () => {
    expect(matches("a{b.c,d}e", "ab.ce")).toBe(true);
    expect(matches("a{b.c,d}e", "ade")).toBe(true);
    expect(matches("a{b.c,d}e", "abe")).toBe(false);
  });

  it("lets an alternative hold a globstar", () => {
    expect(matches("x.{**.a,b}", "x.a")).toBe(true);
    expect(matches("x.{**.a,b}", "x.p.q.a")).toBe(true);
    expect(matches("x.{**.a,b}", "x.b")).toBe(true);
    expect(matches("x.{**,b}", "x")).toBe(true);
    expect(matches("x.{**,b}", "x.p.q")).toBe(true);
  });

  it("reads a globstar alternative glued to characters as *", () => {
    expect(matches("a{**,b}", "axyz")).toBe(true);
    expect(matches("a{**,b}", "a.b")).toBe(false);
  });

  it("lets an alternative hold wildcards and classes", () => {
    expect(matches("{v[0-9],x*}", "v1")).toBe(true);
    expect(matches("{v[0-9],x*}", "xyz")).toBe(true);
    expect(matches("{v[0-9],x*}", "y")).toBe(false);
  });
});

describe("matchKeyPath: reasons", () => {
  it("lists every matched key with its reasons", () => {
    const match = matchKeyPath(pattern("Values.**.enabled"), ["values", "a", "enabled"], fakeCompareKey);
    expect(match).toEqual({
      start: 0,
      end: 3,
      keys: [
        { index: 0, reasons: [{ kind: "case", query: "Values", found: "values" }] },
        { index: 1, reasons: [] },
        { index: 2, reasons: [] },
      ],
    });
  });

  it("names the umlaut variant of a literal beside a wildcard", () => {
    const match = matchKeyPath(pattern("grö*"), ["groesse"], fakeCompareKey);
    expect(match?.keys).toEqual([{ index: 0, reasons: [{ kind: "umlaut", query: "grö", found: "groe" }] }]);
  });

  it("prefers the way to match with the fewest reasons", () => {
    const match = matchKeyPath(pattern("{Gateway,gateway}"), ["gateway"], fakeCompareKey);
    expect(match?.keys).toEqual([{ index: 0, reasons: [] }]);
  });
});

describe("findInChain", () => {
  it("finds the pattern in the middle of a member access chain", () => {
    expect(findInChain(pattern("config.server.port"), ["this", "config", "server", "port"], fakeCompareKey)).toEqual({
      start: 1,
      end: 4,
      keys: [
        { index: 1, reasons: [] },
        { index: 2, reasons: [] },
        { index: 3, reasons: [] },
      ],
    });
  });

  it("finds the pattern at the start of a longer chain", () => {
    expect(findInChain(pattern("config.server"), ["config", "server", "port"], fakeCompareKey)).toMatchObject({ start: 0, end: 2 });
  });

  it("needs the keys in a row", () => {
    expect(findInChain(pattern("config.port"), ["config", "server", "port"], fakeCompareKey)).toBeUndefined();
  });

  it("prefers a run without reasons over an earlier fuzzy one", () => {
    expect(findInChain(pattern("port"), ["porta", "port"], fakeCompareKey)).toMatchObject({ start: 1, end: 2 });
  });

  it("keeps the reasons of a fuzzy run when no exact run exists", () => {
    expect(findInChain(pattern("server.port"), ["a", "servr", "port"], fakeCompareKey)).toEqual({
      start: 1,
      end: 3,
      keys: [
        { index: 1, reasons: [{ kind: "fuzzy", query: "server", found: "servr", edits: 1 }] },
        { index: 2, reasons: [] },
      ],
    });
  });

  it("returns undefined for an empty chain", () => {
    expect(findInChain(pattern("a"), [], fakeCompareKey)).toBeUndefined();
  });
});
