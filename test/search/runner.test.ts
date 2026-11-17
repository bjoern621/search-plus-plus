import * as path from "node:path";
import { describe, expect, it } from "vitest";
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
});
