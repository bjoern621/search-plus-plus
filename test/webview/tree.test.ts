import { describe, expect, it } from "vitest";
import type { FileResult } from "../../src/messages";
import { highlightParts, resultSummary, ResultTree, rowAt, rowOffsets } from "../../src/webview/tree";

function file(folder: string, name: string, rootIndex = 0, root = ""): FileResult {
  return {
    uri: `file:///w${rootIndex}/${folder}/${name}`,
    rootIndex,
    root,
    folder,
    name,
    languageId: "yaml",
    matchCount: 1,
    blocks: [[{ line: 0, text: "a", offset: 0, match: true, ranges: [{ start: 0, end: 1 }] }]],
  };
}

function labels(tree: ResultTree, collapsed: Set<string> = new Set()): string[] {
  return tree.rows(collapsed).map((row) => (row.kind === "folder" ? `folder ${row.label}` : row.kind === "file" ? `file ${row.file.name}` : `line ${row.line.line}`));
}

describe("ResultTree", () => {
  it("lists root files first, then folders in tree order, parents before children", () => {
    const tree = new ResultTree();
    tree.add([file("charts/apim/templates", "a.yaml"), file("charts/apim", "values.yaml"), file("", "README.md"), file("charts/apim", "Chart.yaml"), file("docs", "upgrade.md")]);
    expect(labels(tree)).toEqual([
      "file README.md",
      "line 0",
      "folder charts/apim",
      "file Chart.yaml",
      "line 0",
      "file values.yaml",
      "line 0",
      "folder charts/apim/templates",
      "file a.yaml",
      "line 0",
      "folder docs",
      "file upgrade.md",
      "line 0",
    ]);
    expect(tree.fileCount).toBe(5);
    expect(tree.matchCount).toBe(5);
  });

  it("sorts numbers in names by value", () => {
    const tree = new ResultTree();
    tree.add([file("", "file10.yaml"), file("", "file9.yaml")]);
    expect(labels(tree).filter((label) => label.startsWith("file"))).toEqual(["file file9.yaml", "file file10.yaml"]);
  });

  it("names the workspace folder in a multi-root workspace", () => {
    const tree = new ResultTree();
    tree.add([file("", "b.yaml", 1, "infra"), file("src", "a.yaml", 0, "app")]);
    expect(labels(tree).filter((label) => label.startsWith("folder"))).toEqual(["folder app/src", "folder infra"]);
  });

  it("hides the rows under a collapsed folder or file", () => {
    const tree = new ResultTree();
    const values = file("charts", "values.yaml");
    tree.add([values, file("docs", "upgrade.md")]);
    expect(labels(tree, new Set(["0:docs", values.uri]))).toEqual(["folder charts", "file values.yaml", "folder docs"]);
  });

  it("counts a file sent twice once", () => {
    const tree = new ResultTree();
    tree.add([file("a", "b.yaml")]);
    tree.add([file("a", "b.yaml")]);
    expect(tree.fileCount).toBe(1);
    expect(tree.matchCount).toBe(1);
  });
});

describe("rowAt", () => {
  it("finds the row under a pixel offset", () => {
    const tree = new ResultTree();
    tree.add([file("a", "b.yaml")]);
    const offsets = rowOffsets(tree.rows(new Set()));
    expect(offsets).toEqual([0, 22, 44, 62]);
    expect(rowAt(offsets, 0)).toBe(0);
    expect(rowAt(offsets, 43)).toBe(1);
    expect(rowAt(offsets, 50)).toBe(2);
    expect(rowAt(offsets, 500)).toBe(2);
  });
});

describe("highlightParts", () => {
  it("shifts ranges by the excerpt offset and clips them to the excerpt", () => {
    expect(
      highlightParts({
        line: 0,
        text: "cdefgh",
        offset: 2,
        match: true,
        ranges: [
          { start: 0, end: 3 },
          { start: 5, end: 6 },
          { start: 7, end: 20 },
        ],
      }),
    ).toEqual([
      { text: "c", marked: true },
      { text: "de", marked: false },
      { text: "f", marked: true },
      { text: "g", marked: false },
      { text: "h", marked: true },
    ]);
  });
});

describe("resultSummary", () => {
  it("counts results and files", () => {
    expect(resultSummary(4, 4)).toBe("4 results in 4 files");
    expect(resultSummary(1, 1)).toBe("1 result in 1 file");
    expect(resultSummary(0, 0)).toBe("No results.");
    expect(resultSummary(10000, 812, 10000)).toBe("Showing the first 10,000 results in 812 files");
  });
});
