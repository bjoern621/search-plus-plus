import { describe, expect, it } from "vitest";
import type { CommitInfo, FileResult } from "../../src/messages";
import { PathFilter } from "../../src/search/globs";
import { highlightParts, resultSummary, ResultTree, type Row, rowAt, rowOffsets } from "../../src/webview/tree";

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

/** Names a tree row as `labels` does, without the kind. */
function treeName(row: Exclude<Row, { kind: "line" }>): string {
  switch (row.kind) {
    case "commit":
      return row.commit.shortSha;
    case "folder":
      return row.label;
    case "file":
      return row.folded === "" ? row.file.name : `${row.file.name} (${row.folded})`;
  }
}

function labels(tree: ResultTree, collapsed: Set<string> = new Set()): string[] {
  return tree.rows(collapsed).map((row) => {
    switch (row.kind) {
      case "commit":
        return `commit ${row.commit.shortSha}`;
      case "folder":
        return `folder ${row.label}`;
      case "file":
        return row.folded === "" ? `file ${row.file.name}` : `file ${row.file.name} (${row.folded})`;
      case "line":
        return `line ${row.line.line}`;
    }
  });
}

/** Draws the lines of a row as the view does: `│` where a line passes, `├` or `└` where it joins the row. */
function drawLines(row: Exclude<Row, { kind: "line" }>): string {
  if (row.depth === 0) return "";
  return row.lines.through.map((passes) => (passes ? "│" : " ")).join("") + (row.lines.last ? "└" : "├");
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
  it("nests folders as the explorer does, subfolders before files", () => {
    const tree = new ResultTree();
    tree.add([file("charts/apim/templates", "a.yaml"), file("charts/apim", "values.yaml"), file("", "README.md"), file("charts/apim", "Chart.yaml"), file("docs", "upgrade.md")]);
    expect(labels(tree)).toEqual([
      "folder charts/apim",
      "file a.yaml (templates)",
      "line 0",
      "file Chart.yaml",
      "line 0",
      "file values.yaml",
      "line 0",
      "file upgrade.md (docs)",
      "line 0",
      "file README.md",
      "line 0",
    ]);
    expect(tree.rows(new Set()).map((row) => row.depth)).toEqual([0, 1, 2, 1, 2, 1, 2, 0, 1, 0, 1]);
    expect(tree.fileCount).toBe(5);
    expect(tree.matchCount).toBe(5);
  });

  it("sorts numbers in names by value", () => {
    const tree = new ResultTree();
    tree.add([file("", "file10.yaml"), file("", "file9.yaml")]);
    expect(labels(tree).filter((label) => label.startsWith("file"))).toEqual(["file file9.yaml", "file file10.yaml"]);
  });

  it("heads each workspace folder of a multi-root workspace with its own row", () => {
    const tree = new ResultTree();
    tree.add([file("", "b.yaml", 1, "infra"), file("src", "a.yaml", 0, "app")]);
    expect(labels(tree)).toEqual(["folder app", "file a.yaml (src)", "line 0", "folder infra", "file b.yaml", "line 0"]);
    expect(tree.rows(new Set()).map((row) => row.depth)).toEqual([0, 1, 2, 0, 1, 2]);
  });

  it("joins each row to its parent, with a line passing the rows between a child and a later sibling", () => {
    const tree = new ResultTree();
    tree.add([file("charts/apim", "values.yaml"), file("charts/apim", "Chart.yaml"), file("charts/platform/templates", "ingress.yaml"), file("charts/platform", "values.yaml")]);
    const lines = tree.rows(new Set()).flatMap((row) => (row.kind === "line" ? [] : [`${treeName(row)} ${drawLines(row)}`]));
    expect(lines).toEqual(["charts ", "apim ├", "Chart.yaml │├", "values.yaml │└", "platform └", "ingress.yaml (templates)  ├", "values.yaml  └"]);
  });

  it("hides the rows under a collapsed folder or file", () => {
    const tree = new ResultTree();
    const values = file("charts", "values.yaml");
    tree.add([values, file("charts", "Chart.yaml"), file("docs", "upgrade.md"), file("docs", "sizing.md")]);
    expect(labels(tree, new Set(["0:docs", values.uri]))).toEqual(["folder charts", "file Chart.yaml", "line 0", "file values.yaml", "folder docs"]);
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
    expect(labels(tree)).toEqual(["file values.yaml (charts/apim)", "line 0"]);
    expect(tree.fileCount).toBe(1);
    expect(tree.matchCount).toBe(1);
    tree.setFilter(undefined);
    expect(tree.fileCount).toBe(3);
  });

  it("gives a folder row the icon of its state and replaces icons without a new search", () => {
    const tree = new ResultTree();
    const values = { ...file("charts", "values.yaml"), icons: { file: "yaml", folders: [{ collapsed: "folder", expanded: "folder-open" }] } };
    tree.add([values, file("charts", "zz.yaml")]);
    const icons = (collapsed: Set<string>) => tree.rows(collapsed).map((row) => (row.kind === "folder" ? row.icon : row.kind === "file" ? row.file.icons?.file : ""));
    expect(icons(new Set())).toEqual(["folder-open", "yaml", "", undefined, ""]);
    expect(icons(new Set(["0:charts"]))).toEqual(["folder"]);
    tree.setIcons({ [values.uri]: { file: "yaml-light" } });
    expect(icons(new Set())).toEqual([undefined, "yaml-light", "", undefined, ""]);
  });

  it("folds a chain of folders that leads to one file into the row of that file and keeps a folder row where the tree branches", () => {
    const tree = new ResultTree();
    const atticd = file(".claude/worktrees/atticd-speed/argocd/applications/gitlab", "docs.md");
    tree.add([
      atticd,
      file(".claude/worktrees/edge-latency-bucket/argocd/applications/gitlab", "docs.md"),
      file(".direnv/flake-inputs/f9zw9nsp/nixos/modules/services", "aria2.nix"),
      file("", "flake.nix"),
    ]);
    expect(labels(tree)).toEqual([
      "folder .claude/worktrees",
      "file docs.md (atticd-speed/argocd/applications/gitlab)",
      "line 0",
      "file docs.md (edge-latency-bucket/argocd/applications/gitlab)",
      "line 0",
      "file aria2.nix (.direnv/flake-inputs/f9zw9nsp/nixos/modules/services)",
      "line 0",
      "file flake.nix",
      "line 0",
    ]);
    const lines = tree.rows(new Set()).flatMap((row) => (row.kind === "line" ? [] : [`${treeName(row)} ${drawLines(row)}`]));
    expect(lines).toEqual([
      ".claude/worktrees ",
      "docs.md (atticd-speed/argocd/applications/gitlab) ├",
      "docs.md (edge-latency-bucket/argocd/applications/gitlab) └",
      "aria2.nix (.direnv/flake-inputs/f9zw9nsp/nixos/modules/services) ",
      "flake.nix ",
    ]);
    expect(labels(tree, new Set([atticd.uri])).slice(0, 3)).toEqual(["folder .claude/worktrees", "file docs.md (atticd-speed/argocd/applications/gitlab)", "file docs.md (edge-latency-bucket/argocd/applications/gitlab)"]);
  });

  it("splits a folded row into folder rows once a second file joins its folder", () => {
    const tree = new ResultTree();
    tree.add([file("docs", "upgrade.md")]);
    expect(labels(tree)).toEqual(["file upgrade.md (docs)", "line 0"]);
    tree.add([file("docs", "sizing.md")]);
    expect(labels(tree)).toEqual(["folder docs", "file sizing.md", "line 0", "file upgrade.md", "line 0"]);
  });
});

describe("rowAt", () => {
  it("finds the row under a pixel offset", () => {
    const tree = new ResultTree();
    tree.add([file("a", "b.yaml"), file("a", "c.yaml")]);
    const offsets = rowOffsets(tree.rows(new Set()));
    expect(offsets).toEqual([0, 22, 44, 66, 88, 110]);
    expect(rowAt(offsets, 0)).toBe(0);
    expect(rowAt(offsets, 43)).toBe(1);
    expect(rowAt(offsets, 50)).toBe(2);
    expect(rowAt(offsets, 500)).toBe(4);
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
      "file values.yaml (charts/apim)",
      "line 0",
      "file upgrade.md (docs)",
      "line 0",
      "commit 1111111",
      "file Chart.yaml (charts/apim)",
      "line 0",
      "file README.md",
      "line 0",
    ]);
    expect(tree.commitCount).toBe(2);
    expect(tree.fileCount).toBe(4);
  });

  it("keeps a file that two commits changed apart under each commit", () => {
    const tree = new ResultTree();
    tree.add([committed(commit(0), "docs", "upgrade.md"), committed(commit(1), "docs", "upgrade.md")]);
    expect(labels(tree)).toEqual(["commit 0000000", "file upgrade.md (docs)", "line 0", "commit 1111111", "file upgrade.md (docs)", "line 0"]);
    expect(tree.matchCount).toBe(2);
  });

  it("hides the rows below a collapsed commit", () => {
    const tree = new ResultTree();
    tree.add([committed(commit(0), "docs", "upgrade.md"), committed(commit(1), "docs", "sizing.md")]);
    expect(labels(tree, new Set([`commit:${commit(0).sha}`]))).toEqual(["commit 0000000", "commit 1111111", "file sizing.md (docs)", "line 0"]);
  });

  it("drops a commit row once the filter hides every file of the commit", () => {
    const tree = new ResultTree();
    tree.add([committed(commit(0), "docs", "upgrade.md"), committed(commit(1), "charts", "Chart.yaml")]);
    tree.setFilter(new PathFilter({ include: "", exclude: "Chart.yaml" }));
    expect(labels(tree)).toEqual(["commit 0000000", "file upgrade.md (docs)", "line 0"]);
    expect(tree.commitCount).toBe(1);
  });
});
