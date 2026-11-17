import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { BranchSource, HistorySource } from "../../src/git/sources";
import type { RevisionSource } from "../../src/search/revisions";
import { repositoryWith } from "./repositorySetup";

/** Reads every batch of `source` and returns the relative paths that it yields. */
async function yieldedPaths(source: RevisionSource): Promise<string[]> {
  const paths: string[] = [];
  for await (const batch of source.batches(() => true, new AbortController().signal)) paths.push(...batch.map((file) => file.relativePath));
  return paths;
}

describe("Git revision sources", () => {
  it("reads the other folders when git cannot start in the top folder of one", async () => {
    const broken = await repositoryWith(0, { "a.txt": "a\n" });
    broken.repository = { ...broken.repository, top: path.join(broken.cwd, "deleted") };
    const intact = await repositoryWith(1, { "b.txt": "b\n" });
    for (const make of [(log: (message: string) => void) => new BranchSource("git", [broken, intact], "main", log), (log: (message: string) => void) => new HistorySource("git", [broken, intact], log)]) {
      const log: string[] = [];
      expect(await yieldedPaths(make((message) => log.push(message)))).toEqual(["b.txt"]);
      expect(log.join("\n")).toContain("ENOENT");
    }
  });
});
