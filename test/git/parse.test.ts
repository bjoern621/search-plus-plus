import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { BRANCH_FORMAT, CatFileParser, HistoryParser, historyLogArgs, nulList, type ParsedCommit, parseBranches, parseLsTree, unquoteGitPath } from "../../src/git/parse";

function parseHistory(output: string): ParsedCommit[] {
  const commits: ParsedCommit[] = [];
  const parser = new HistoryParser((commit) => commits.push(commit));
  for (const line of output.split("\n")) parser.line(line);
  parser.end();
  return commits;
}

const header = (sha: string, subject: string) => `\0${sha.repeat(40)}\0${sha.repeat(7)}\0Ada Lovelace\x002026-11-02T14:03:00+01:00\0${subject}`;

describe("parseLsTree", () => {
  it("reads mode, type, object, size and path, and leaves the size of a submodule undefined", () => {
    const output = ["100644 blob 1111111111111111111111111111111111111111      42\tcharts/values.yaml", "160000 commit 2222222222222222222222222222222222222222       -\tvendor/lib", "100644 blob 3333333333333333333333333333333333333333       7\tdocs/with\ttab.md", ""].join("\0");
    expect(parseLsTree(output)).toEqual([
      { mode: "100644", type: "blob", object: "1".repeat(40), sizeBytes: 42, path: "charts/values.yaml" },
      { mode: "160000", type: "commit", object: "2".repeat(40), sizeBytes: undefined, path: "vendor/lib" },
      { mode: "100644", type: "blob", object: "3".repeat(40), sizeBytes: 7, path: "docs/with\ttab.md" },
    ]);
  });
});

describe("nulList", () => {
  it("splits at NUL bytes and drops the empty entry after the last one", () => {
    expect(nulList("a\0b c\0")).toEqual(["a", "b c"]);
    expect(nulList("")).toEqual([]);
  });
});

describe("parseBranches", () => {
  it("leaves out the checked-out branch and symbolic refs", () => {
    const output = [" \0\0feature\x003 days ago\0Try the gateway 5.0.0", "*\0\0topic\x001 hour ago\0Raise the gateway", " \0refs/remotes/origin/main\0origin\x002 days ago\0Add the chart", " \0\0origin/main\x002 days ago\0Add the chart", ""].join("\n");
    expect(parseBranches(output)).toEqual([
      { name: "feature", relativeDate: "3 days ago", subject: "Try the gateway 5.0.0" },
      { name: "origin/main", relativeDate: "2 days ago", subject: "Add the chart" },
    ]);
  });
});

describe("unquoteGitPath", () => {
  it("decodes octal UTF-8 bytes and C escapes inside quotes", () => {
    expect(unquoteGitPath('"b/caf\\303\\251.md"')).toBe("b/café.md");
    expect(unquoteGitPath('"b/a\\tb\\"c\\\\d"')).toBe('b/a\tb"c\\d');
  });

  it("returns a path without quotes unchanged", () => {
    expect(unquoteGitPath("b/charts/values.yaml")).toBe("b/charts/values.yaml");
  });
});

describe("HistoryParser", () => {
  it("collects the added lines of each file per commit, newest commit first", () => {
    const output = [
      header("a", "Raise the gateway to 4.1.0"),
      "",
      "diff --git a/charts/values.yaml b/charts/values.yaml",
      "index 1111111..2222222 100644",
      "--- a/charts/values.yaml",
      "+++ b/charts/values.yaml",
      "@@ -4 +4 @@ gateway:",
      "-    tag: 4.0.0",
      "+    tag: 4.1.0",
      "@@ -9,0 +10,2 @@",
      "+  replicas: 2",
      "+  port: 80",
      "diff --git a/docs/old.md b/docs/old.md",
      "deleted file mode 100644",
      "--- a/docs/old.md",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-gone",
      header("b", "Add the chart"),
      "",
      "diff --git a/Chart.yaml b/Chart.yaml",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/Chart.yaml",
      "@@ -0,0 +1,2 @@",
      "+name: apim",
      "+version: 4.1.0",
      "\\ No newline at end of file",
      "diff --git a/logo.png b/logo.png",
      "Binary files /dev/null and b/logo.png differ",
    ].join("\n");
    const commits = parseHistory(output);
    expect(commits.map((commit) => [commit.commit.shortSha, commit.commit.index, commit.commit.subject])).toEqual([
      ["aaaaaaa", 0, "Raise the gateway to 4.1.0"],
      ["bbbbbbb", 1, "Add the chart"],
    ]);
    expect(commits[0]?.commit).toMatchObject({ sha: "a".repeat(40), author: "Ada Lovelace", date: "2026-11-02T14:03:00+01:00" });
    expect(commits.map((commit) => commit.files)).toEqual([[{ path: "charts/values.yaml", addedLines: [3, 9, 10] }], [{ path: "Chart.yaml", addedLines: [0, 1] }]]);
  });

  it("takes an added line that looks like a file header as content", () => {
    const output = [header("c", "Quote a diff"), "", "diff --git a/notes.md b/notes.md", "--- a/notes.md", "+++ b/notes.md", "@@ -1,0 +2,2 @@", "+++ b/other.md", "+--- a/other.md"].join("\n");
    expect(parseHistory(output)[0]?.files).toEqual([{ path: "notes.md", addedLines: [1, 2] }]);
  });

  it("hands over a commit without changed files", () => {
    expect(parseHistory([header("d", "Merge branch feature"), ""].join("\n")).map((commit) => commit.files)).toEqual([[]]);
  });
});

describe("CatFileParser", () => {
  it("reads objects that arrive split across chunks, and a missing one", () => {
    const parser = new CatFileParser();
    const output = Buffer.from(`${"1".repeat(40)} blob 5\nhello\nHEAD:nope missing\n${"2".repeat(40)} blob 0\n\n`);
    const objects = [...parser.push(output.subarray(0, 50)), ...parser.push(output.subarray(50, 51)), ...parser.push(output.subarray(51))];
    expect(objects.map((object) => (object.kind === "found" ? [object.type, object.bytes.toString()] : ["missing"]))).toEqual([["blob", "hello"], ["missing"], ["blob", ""]]);
  });
});

describe("the parsers against git", () => {
  const repo = mkdtempSync(join(tmpdir(), "structural-search-parse-"));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "Ada", GIT_AUTHOR_EMAIL: "ada@example.com", GIT_COMMITTER_NAME: "Ada", GIT_COMMITTER_EMAIL: "ada@example.com" };
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, env }).toString("utf8");
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  git("init", "--quiet", "--initial-branch=main");
  writeFileSync(join(repo, "values.yaml"), "image:\n  tag: 4.0.0\n");
  writeFileSync(join(repo, "café.md"), "Größe\n");
  git("add", ".");
  git("commit", "--quiet", "--message", "Add the chart", "--date", "2026-11-01T10:00:00+01:00");
  writeFileSync(join(repo, "values.yaml"), "image:\n  tag: 4.1.0\n  pullPolicy: Always\n");
  git("commit", "--quiet", "--all", "--message", "Raise the tag", "--date", "2026-11-02T10:00:00+01:00");
  git("branch", "feature");

  it("reads the history that git log prints with the history arguments", () => {
    const commits = parseHistory(git(...historyLogArgs(10)));
    expect(commits.map((commit) => [commit.commit.subject, commit.commit.date, commit.files])).toEqual([
      ["Raise the tag", "2026-11-02T10:00:00+01:00", [{ path: "values.yaml", addedLines: [1, 2] }]],
      [
        "Add the chart",
        "2026-11-01T10:00:00+01:00",
        [
          { path: "café.md", addedLines: [0] },
          { path: "values.yaml", addedLines: [0, 1] },
        ],
      ],
    ]);
  });

  it("reads the branches and the tree that git prints", () => {
    expect(parseBranches(git("for-each-ref", `--format=${BRANCH_FORMAT}`, "refs/heads")).map((branch) => branch.name)).toEqual(["feature"]);
    expect(parseLsTree(git("ls-tree", "-r", "-l", "-z", "feature")).map((entry) => [entry.path, entry.sizeBytes])).toEqual([
      ["café.md", 8],
      ["values.yaml", 41],
    ]);
  });
});
