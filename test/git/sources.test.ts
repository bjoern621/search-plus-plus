import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { BranchSource, HistorySource } from "../../src/git/sources";
import type { RevisionSource } from "../../src/search/revisions";
import { FILE_SIZE_LIMIT_BYTES } from "../../src/search/config";
import { git, repositoryWith } from "./repositorySetup";

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

  it("skips a file over the size limit without reading it from Git", async () => {
    const place = await repositoryWith(0, { "big.txt": "x".repeat(FILE_SIZE_LIMIT_BYTES + 1), "small.txt": "small\n" });
    const bigBlob = git(place.cwd, "rev-parse", "HEAD:big.txt").trim();
    const requests = path.join(place.cwd, "..", `${path.basename(place.cwd)}-requests.txt`);
    const gitPath = path.join(place.cwd, "..", `${path.basename(place.cwd)}-git.sh`);
    // Records the names that `git cat-file --batch` gets asked for, which name the files that a source reads.
    await writeFile(gitPath, `#!/bin/sh\nif [ "$1" = "cat-file" ] && [ "$2" = "--batch" ]; then tee -a '${requests}' | git "$@"; else exec git "$@"; fi\n`, { mode: 0o755 });
    for (const source of [new BranchSource(gitPath, [place], "main", () => {}), new HistorySource(gitPath, [place], () => {})]) {
      await writeFile(requests, "");
      expect(await yieldedPaths(source)).toEqual(["small.txt"]);
      const requested = await readFile(requests, "utf8");
      expect(requested).not.toContain("big.txt");
      expect(requested).not.toContain(bigBlob);
    }
  });
});
