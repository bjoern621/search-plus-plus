import { describe, expect, it } from "vitest";
import type { GitInfo, SearchScope } from "../../src/search/scope";
import type { MenuContent } from "../../src/webview/menu";
import { scopeLabel, scopeMenu } from "../../src/webview/scopeMenu";

const repository: GitInfo = { kind: "repository", defaultBranch: "main" };

/** Writes each item as the integration tests read the menu. */
function items(menu: MenuContent): string[] {
  return menu.groups.flatMap((group) => group.map((item) => `${item.checked ? "✓ " : ""}${item.label}${item.description ? ` (${item.description})` : ""}${item.disabled ? " [disabled]" : ""}`));
}

describe("scopeMenu", () => {
  it("offers every scope inside a repository and marks the current one", () => {
    const menu = scopeMenu({ kind: "history" }, repository);
    expect(menu.reasons).toEqual([]);
    expect(items(menu)).toEqual(["Working tree", "Files changed against main", "Another branch…", "✓ Git history (Last 200 commits)"]);
  });

  it("names the branch being searched above the item that picks another", () => {
    expect(items(scopeMenu({ kind: "branch", branch: "feature" }, repository))).toEqual(["Working tree", "Files changed against main", "✓ Branch feature", "Another branch…", "Git history (Last 200 commits)"]);
  });

  it("disables the Git scopes outside a repository and says why", () => {
    const menu = scopeMenu({ kind: "workingTree" }, { kind: "none", reason: "No Git repository holds the workspace folders." });
    expect(menu.reasons).toEqual(["No Git repository holds the workspace folders."]);
    expect(items(menu)).toEqual(["✓ Working tree", "Files changed against main [disabled]", "Another branch… [disabled]", "Git history (Last 200 commits) [disabled]"]);
  });

  it("disables the changed files scope without a default branch", () => {
    expect(items(scopeMenu({ kind: "workingTree" }, { kind: "repository", defaultBranch: undefined }))[1]).toBe("Files changed against main (No main or master branch to compare against) [disabled]");
  });

  it("picks a scope or asks for a branch", () => {
    const actions = scopeMenu({ kind: "workingTree" }, { kind: "repository", defaultBranch: "master" }).groups.flat().map((item) => item.action);
    expect(actions).toEqual([
      { kind: "scope", scope: { kind: "workingTree" } },
      { kind: "scope", scope: { kind: "changed" } },
      { kind: "pickBranch" },
      { kind: "scope", scope: { kind: "history" } },
    ]);
  });
});

describe("scopeLabel", () => {
  it("names the scope on the button", () => {
    const scopes: SearchScope[] = [{ kind: "workingTree" }, { kind: "changed" }, { kind: "branch", branch: "feature" }, { kind: "history" }];
    expect(scopes.map((scope) => scopeLabel(scope, { kind: "repository", defaultBranch: "master" }))).toEqual(["Working tree", "Changed against master", "Branch feature", "Git history"]);
  });
});
