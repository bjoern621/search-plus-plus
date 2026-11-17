import { BRANCH_FORMAT, type BranchEntry, nulList, parseBranches } from "./parse";
import { gitText, runGit } from "./cli";

/** The Git repository that holds one workspace folder. */
export interface Repository {
  /** The top folder of the work tree, as git prints it with `/` as separator. */
  top: string;
  /** The path of the workspace folder below `top`, ending in `/`. Empty when the workspace folder is the top. */
  prefix: string;
}

/** The branches that a merge base gets taken against, in the order of preference after `origin/HEAD`. */
const DEFAULT_BRANCH_CANDIDATES = ["main", "master", "origin/main", "origin/master"];

/** Finds the repository that holds `folder`. Returns undefined outside a repository and when git cannot run. */
export async function findRepository(gitPath: string, folder: string): Promise<Repository | undefined> {
  const output = await gitText(gitPath, ["rev-parse", "--show-toplevel", "--show-prefix"], { cwd: folder }).catch(() => undefined);
  if (output === undefined) return undefined;
  const [top, prefix] = output.split("\n");
  if (top === undefined || top === "") return undefined;
  return { top, prefix: prefix ?? "" };
}

/** A branch to compare against and the name that the view shows for it, such as `origin/main` shown as `main`. */
export interface DefaultBranch {
  ref: string;
  name: string;
}

/** Finds the default branch: the one that `origin/HEAD` points at, else the first of `DEFAULT_BRANCH_CANDIDATES` that exists. */
export async function defaultBranch(gitPath: string, cwd: string): Promise<DefaultBranch | undefined> {
  const remoteHead = await gitText(gitPath, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], { cwd }).catch(() => undefined);
  const candidates = remoteHead === undefined ? DEFAULT_BRANCH_CANDIDATES : [remoteHead.trim(), ...DEFAULT_BRANCH_CANDIDATES];
  for (const ref of candidates) {
    const exit = await runGit(gitPath, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { cwd });
    if (exit.code === 0) return { ref, name: ref.replace(/^origin\//, "") };
  }
  return undefined;
}

/**
 * Lists the files below `cwd` that differ from the merge base of HEAD and `base`: committed, staged, unstaged and untracked.
 * Paths are relative to `cwd`, with `/` as separator. Deleted files stay out.
 */
export async function changedPaths(gitPath: string, cwd: string, base: string, signal: AbortSignal): Promise<Set<string>> {
  const mergeBase = (await gitText(gitPath, ["merge-base", "HEAD", base], { cwd, signal })).trim();
  const [changed, untracked] = await Promise.all([
    gitText(gitPath, ["diff", "--name-only", "-z", "--no-renames", "--relative", "--diff-filter=d", mergeBase, "--", "."], { cwd, signal }),
    gitText(gitPath, ["ls-files", "--others", "--exclude-standard", "-z", "--", "."], { cwd, signal }),
  ]);
  return new Set([...nulList(changed), ...nulList(untracked)]);
}

/** Lists the local and remote branches, the most recent commit first. Leaves out the checked-out branch. */
export async function listBranches(gitPath: string, cwd: string): Promise<BranchEntry[]> {
  const output = await gitText(gitPath, ["for-each-ref", "--sort=-committerdate", `--format=${BRANCH_FORMAT}`, "refs/heads", "refs/remotes"], { cwd });
  return parseBranches(output);
}
