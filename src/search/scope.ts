/** Where a search runs. The view keeps it across searches. */
export type SearchScope =
  | { kind: "workingTree" }
  /** The files that differ from the merge base with the default branch, uncommitted and untracked files included. */
  | { kind: "changed" }
  /** Every tracked file of `branch`, read from Git without a checkout. */
  | { kind: "branch"; branch: string }
  /** The lines that the latest commits on HEAD added or changed, grouped by commit. */
  | { kind: "history" };

export const WORKING_TREE: SearchScope = { kind: "workingTree" };

/** What the view needs to know about Git to offer the Git scopes. */
export type GitInfo =
  /** `defaultBranch` holds the name to show, such as `main`. Missing when the repository has neither `main` nor `master`. */
  | { kind: "repository"; defaultBranch: string | undefined }
  /** `reason` says why the Git scopes stay unavailable. */
  | { kind: "none"; reason: string };

export function sameScope(a: SearchScope, b: SearchScope): boolean {
  if (a.kind === "branch" && b.kind === "branch") return a.branch === b.branch;
  return a.kind === b.kind;
}
