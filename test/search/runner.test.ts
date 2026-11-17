import { writeFile } from "node:fs/promises";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { HistorySource } from "../../src/git/sources";
import { git, repositoryWith } from "../git/repositorySetup";
import { folderWith, matchedLines, rootAt, runSearch } from "./runnerSetup";

describe("SearchRunner", () => {
  it("searches the other folders when ripgrep cannot start in a deleted folder", async () => {
    const dir = await folderWith({ "a.txt": "needle\n" });
    const roots = [rootAt(0, path.join(dir, "deleted")), rootAt(1, dir)];
    for (const query of ["needle", "/needle/"]) {
      const result = await runSearch(query, roots);
      expect(result.outcome).toEqual({ status: "complete" });
      expect(matchedLines(result.files)).toEqual(["a.txt:1: needle"]);
      expect(result.log.join("\n")).toContain("ENOENT");
    }
  });

  it("counts a lone carriage return as a line break, as the editor does", async () => {
    const dir = await folderWith({ "a.txt": "one\rneedle\r\nthree\n" });
    for (const query of ["needle", "/needle/"]) {
      const result = await runSearch(query, [rootAt(0, dir)]);
      expect(matchedLines(result.files)).toEqual(["a.txt:2: needle"]);
    }
  });

  it("counts a lone carriage return as a line break in the lines that a commit added", async () => {
    const place = await repositoryWith(0, { "a.txt": "needle\n" });
    await writeFile(path.join(place.cwd, "a.txt"), "needle\rneedle\n");
    git(place.cwd, "commit", "--quiet", "--all", "--message", "Add a needle");
    for (const query of ["needle", "/needle/"]) {
      const result = await runSearch(query, [place.root], { files: { kind: "revisions", source: new HistorySource("git", [place], () => {}) } });
      expect(matchedLines(result.files)).toEqual(["a.txt:1: needle", "a.txt:1: needle", "a.txt:2: needle"]);
    }
  });
});
