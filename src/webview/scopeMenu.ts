import { HISTORY_COMMIT_LIMIT } from "../search/config";
import { type GitInfo, type SearchScope, sameScope } from "../search/scope";
import { assertNever } from "../search/assert";
import type { MenuContent, MenuItem } from "./menu";

/** The name of the default branch before the host has found it. */
const FALLBACK_DEFAULT_BRANCH = "main";

/** Names the scope on the button at the end of the summary line, such as `Branch feature`. */
export function scopeLabel(scope: SearchScope, git: GitInfo | undefined): string {
  switch (scope.kind) {
    case "workingTree":
      return "Working tree";
    case "changed":
      return `Changed against ${defaultBranchName(git)}`;
    case "branch":
      return `Branch ${scope.branch}`;
    case "history":
      return "Git history";
    default:
      assertNever(scope);
  }
}

/**
 * Lays out the menu behind the scope button, with a check mark on `current`.
 * Outside a repository, the Git scopes show disabled, and the menu says why.
 * `git` stays undefined until the host has looked, and the Git scopes stay enabled meanwhile.
 */
export function scopeMenu(current: SearchScope, git: GitInfo | undefined): MenuContent {
  const noGit = git?.kind === "none";
  const noDefaultBranch = git?.kind === "repository" && git.defaultBranch === undefined;
  const item = (label: string, scope: SearchScope, extra: Partial<MenuItem> = {}): MenuItem => ({ label, action: { kind: "scope", scope }, checked: sameScope(current, scope), ...extra });

  const gitItems: MenuItem[] = [
    item(`Files changed against ${defaultBranchName(git)}`, { kind: "changed" }, noDefaultBranch ? { disabled: true, description: "No main or master branch to compare against" } : {}),
  ];
  if (current.kind === "branch") gitItems.push(item(`Branch ${current.branch}`, current));
  gitItems.push(
    { label: "Another branch…", action: { kind: "pickBranch" }, checked: false },
    item("Git history", { kind: "history" }, { description: `Last ${HISTORY_COMMIT_LIMIT} commits` }),
  );
  if (noGit) for (const gitItem of gitItems) gitItem.disabled = true;

  return { reasons: noGit ? [git.reason] : [], groups: [[item("Working tree", { kind: "workingTree" })], gitItems] };
}

function defaultBranchName(git: GitInfo | undefined): string {
  return (git?.kind === "repository" ? git.defaultBranch : undefined) ?? FALLBACK_DEFAULT_BRANCH;
}
