import { describe, expect, it } from "vitest";
import type { FileResult, ResultLine } from "../../src/messages";
import { matchMenu, quoteWord, reasonLines } from "../../src/webview/menu";

const file = { uri: "file:///w/charts/apim/values.yaml", folder: "charts/apim", name: "values.yaml" } as FileResult;
const line: ResultLine = { line: 3, text: "  gravitee:", offset: 0, match: true, ranges: [{ start: 2, end: 10 }] };

describe("matchMenu", () => {
  it("offers to find the stretched word as written, to exclude and to copy", () => {
    const menu = matchMenu(
      file,
      { ...line, reasons: [{ kind: "fuzzy", query: "Gravite", found: "gravitee", edits: 1 }], keyPath: ["global", "gravitee"] },
      "global.Gravite",
    );
    expect(menu.reasons).toEqual(["Key gravitee: close spelling of Gravite, 1 edit away."]);
    expect(menu.groups.map((group) => group.map((item) => item.label))).toEqual([
      ['Find "Gravite" as written'],
      ["Exclude values.yaml", "Exclude folder charts/apim"],
      ["Copy line", "Copy key path"],
    ]);
    expect(menu.groups[0]?.[0]?.action).toEqual({ kind: "search", query: 'global."Gravite"' });
    expect(menu.groups[2]?.[1]?.action).toEqual({ kind: "copy", text: "global.gravitee" });
  });

  it("leaves out what a plain match at the workspace folder has no use for", () => {
    const menu = matchMenu({ ...file, folder: "" }, line, "gravitee");
    expect(menu.reasons).toEqual([]);
    expect(menu.groups.map((group) => group.map((item) => item.label))).toEqual([["Exclude values.yaml"], ["Copy line"]]);
  });
});

describe("reasonLines", () => {
  it("names umlauts in both directions and joins case differences into one line", () => {
    expect(
      reasonLines(
        [
          { kind: "umlaut", query: "Größe", found: "Groesse" },
          { kind: "umlaut", query: "Groesse", found: "Größe" },
          { kind: "case", query: "Global", found: "global" },
          { kind: "case", query: "Values", found: "values" },
          { kind: "case", query: "Enabled", found: "enabled" },
          { kind: "fuzzy", query: "Gröse", found: "Größe", edits: 2 },
        ],
        ["global", "values", "enabled"],
      ),
    ).toEqual([
      "Groesse: spelled-out umlaut of Größe.",
      "Größe: umlaut spelling of Groesse.",
      "Größe: close spelling of Gröse, 2 edits away.",
      "Keys global, values and enabled: case differs.",
    ]);
  });
});

describe("quoteWord", () => {
  it("quotes the first whole word outside quotes and escapes", () => {
    expect(quoteWord("image imag", "imag")).toBe('image "imag"');
    expect(quoteWord('"imag" imag', "imag")).toBe('"imag" "imag"');
    expect(quoteWord("\\imag.imag", "imag")).toBe('\\imag."imag"');
  });

  it("returns undefined when the query holds no such word", () => {
    expect(quoteWord("images", "imag")).toBeUndefined();
  });
});
