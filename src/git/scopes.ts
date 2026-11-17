import type { FileSource } from "../search/runner";
import type { GitInfo, SearchScope } from "../search/scope";
import { assertNever } from "../search/assert";
import type { SearchRoot } from "../search/workspaceEngine";
import { changedPaths, defaultBranch, findRepository } from "./repository";
import { BranchSource, HistorySource, type RootRepository } from "./sources";

export type PreparedScope = { kind: "ready"; files: FileSource } | { kind: "noRepository" };

/**
 * Finds the files that a search in `scope` reads.
 * A Git scope skips workspace folders outside a repository. It needs at least one folder inside one.
 */
export async function prepareScope(gitPath: string, scope: SearchScope, roots: readonly SearchRoot[], signal: AbortSignal, log: (message: string) => void): Promise<PreparedScope> {
  if (scope.kind === "workingTree") return { kind: "ready", files: { kind: "disk" } };
  const places = await rootRepositories(gitPath, roots);
  if (places.length === 0) return { kind: "noRepository" };
  switch (scope.kind) {
    case "changed":
      return { kind: "ready", files: { kind: "disk", onlyPaths: await changedPathsByRoot(gitPath, places, signal, log) } };
    case "branch":
      return { kind: "ready", files: { kind: "revisions", source: new BranchSource(gitPath, places, scope.branch, log) } };
    case "history":
      return { kind: "ready", files: { kind: "revisions", source: new HistorySource(gitPath, places, log) } };
    default:
      assertNever(scope);
  }
}

/** Says whether the Git scopes can run, for the scope menu. Reads the first workspace folder inside a repository. */
export async function describeGit(gitPath: string, roots: readonly SearchRoot[]): Promise<GitInfo> {
  if (roots.length === 0) return { kind: "none", reason: "Open a folder to search Git." };
  const [first] = await rootRepositories(gitPath, roots);
  if (!first) return { kind: "none", reason: "No Git repository holds the workspace folders. Open a folder inside one to search Git." };
  const branch = await defaultBranch(gitPath, first.cwd);
  return { kind: "repository", defaultBranch: branch?.name };
}

/** Pairs each workspace folder on disk with its repository. Leaves out the folders outside one. */
export async function rootRepositories(gitPath: string, roots: readonly SearchRoot[]): Promise<RootRepository[]> {
  const found = await Promise.all(
    roots.map(async (root) => {
      if (root.fsPath === undefined) return [];
      const repository = await findRepository(gitPath, root.fsPath);
      return repository ? [{ root, cwd: root.fsPath, repository }] : [];
    }),
  );
  return found.flat();
}

/** Maps each root index to the files that differ from its default branch. A folder without a default branch gets no files. */
async function changedPathsByRoot(gitPath: string, places: readonly RootRepository[], signal: AbortSignal, log: (message: string) => void): Promise<Map<number, Set<string>>> {
  const byRoot = new Map<number, Set<string>>();
  for (const place of places) {
    const base = await defaultBranch(gitPath, place.cwd);
    if (!base) {
      log(`No default branch to compare ${place.cwd} against`);
      continue;
    }
    try {
      byRoot.set(place.root.index, await changedPaths(gitPath, place.cwd, base.ref, signal));
    } catch (error) {
      if (!signal.aborted) log(`Could not list the changed files of ${place.cwd}: ${String(error)}`);
    }
  }
  return byRoot;
}
