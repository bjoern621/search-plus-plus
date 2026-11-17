import { describe, expect, it } from "vitest";
import type { CommitInfo, FileResult } from "../../src/messages";
import { PathFilter } from "../../src/search/globs";
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
  return tree.rows(collapsed).map((row) => {
    switch (row.kind) {
      case "commit":
        return `commit ${row.commit.shortSha}`;
      case "folder":
        return `folder ${row.label}`;
      case "file":
        return `file ${row.file.name}`;
      case "line":
        return `line ${row.line.line}`;
    }
  });
}

function commit(index: number): CommitInfo {
  const sha = String(index).repeat(40);
  return { sha, shortSha: sha.slice(0, 7), author: "Ada", date: "2026-11-02T14:03:00+01:00", subject: `Commit ${index}`, index };
}

/** A file as a commit changed it. The URI names the commit, as revision URIs do. */
function committed(at: CommitInfo, folder: string, name: string): FileResult {
  return { ...file(folder, name), uri: `structural-search-git:/w0/${folder}/${name}?${at.sha}`, commit: at };
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

  it("hides and stops counting the files that its filter rejects, with their folder once it empties", () => {
    const tree = new ResultTree();
    tree.add([file("charts/apim", "values.yaml"), file("charts/apim", "Chart.yaml"), file("docs", "upgrade.md")]);
    tree.setFilter(new PathFilter({ include: "", exclude: "./docs/, Chart.yaml" }));
    expect(labels(tree)).toEqual(["folder charts/apim", "file values.yaml", "line 0"]);
    expect(tree.fileCount).toBe(1);
    expect(tree.matchCount).toBe(1);
    tree.setFilter(undefined);
    expect(tree.fileCount).toBe(3);
  });

  it("gives a folder row the icon of its state and replaces icons without a new search", () => {
    const tree = new ResultTree();
    const values = { ...file("charts", "values.yaml"), icons: { file: "yaml", folder: "folder", folderExpanded: "folder-open" } };
    tree.add([values]);
    const icons = (collapsed: Set<string>) => tree.rows(collapsed).map((row) => (row.kind === "folder" ? row.icon : row.kind === "file" ? row.file.icons?.file : ""));
    expect(icons(new Set())).toEqual(["folder-open", "yaml", ""]);
    expect(icons(new Set(["0:charts"]))).toEqual(["folder"]);
    tree.setIcons({ [values.uri]: { file: "yaml-light" } });
    expect(icons(new Set())).toEqual([undefined, "yaml-light", ""]);
  });
});

describe("rowAt", () => {
  it("finds the row under a pixel offset", () => {
    const tree = new ResultTree();
    tree.add([file("a", "b.yaml")]);
    const offsets = rowOffsets(tree.rows(new Set()));
    expect(offsets).toEqual([0, 22, 44, 66]);
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

  it("counts commits in place of files in the Git history scope", () => {
    expect(resultSummary(3, 3, undefined, 2)).toBe("3 results in 2 commits");
    expect(resultSummary(1, 1, undefined, 1)).toBe("1 result in 1 commit");
    expect(resultSummary(10000, 812, 10000, 40)).toBe("Showing the first 10,000 results in 40 commits");
  });
});

describe("ResultTree in the Git history scope", () => {
  it("heads the folders of each commit with a commit row, the newest commit first", () => {
    const tree = new ResultTree();
    const [newest, older] = [commit(0), commit(1)];
    tree.add([committed(older, "charts/apim", "Chart.yaml"), committed(newest, "charts/apim", "values.yaml"), committed(older, "", "README.md"), committed(newest, "docs", "upgrade.md")]);
    expect(labels(tree)).toEqual([
      "commit 0000000",
      "folder charts/apim",
      "file values.yaml",
      "line 0",
      "folder docs",
      "file upgrade.md",
      "line 0",
      "commit 1111111",
      "file README.md",
      "line 0",
      "folder charts/apim",
      "file Chart.yaml",
      "line 0",
    ]);
    expect(tree.commitCount).toBe(2);
    expect(tree.fileCount).toBe(4);
  });

  it("keeps a file that two commits changed apart under each commit", () => {
    const tree = new ResultTree();
    tree.add([committed(commit(0), "docs", "upgrade.md"), committed(commit(1), "docs", "upgrade.md")]);
    expect(labels(tree)).toEqual(["commit 0000000", "folder docs", "file upgrade.md", "line 0", "commit 1111111", "folder docs", "file upgrade.md", "line 0"]);
    expect(tree.matchCount).toBe(2);
  });

  it("hides the rows below a collapsed commit", () => {
    const tree = new ResultTree();
    tree.add([committed(commit(0), "docs", "upgrade.md"), committed(commit(1), "docs", "sizing.md")]);
    expect(labels(tree, new Set([`commit:${commit(0).sha}`]))).toEqual(["commit 0000000", "commit 1111111", "folder docs", "file sizing.md", "line 0"]);
  });

  it("drops a commit row once the filter hides every file of the commit", () => {
    const tree = new ResultTree();
    tree.add([committed(commit(0), "docs", "upgrade.md"), committed(commit(1), "charts", "Chart.yaml")]);
    tree.setFilter(new PathFilter({ include: "", exclude: "Chart.yaml" }));
    expect(labels(tree)).toEqual(["commit 0000000", "folder docs", "file upgrade.md", "line 0"]);
    expect(tree.commitCount).toBe(1);
  });
});
