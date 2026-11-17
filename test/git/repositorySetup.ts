import { execFileSync } from "node:child_process";
import type { RootRepository } from "../../src/git/sources";
import { folderWith, rootAt } from "../search/runnerSetup";

/** Runs git in `cwd`, apart from the Git configuration of the machine. */
export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "Ada Lovelace", GIT_AUTHOR_EMAIL: "ada@example.com", GIT_COMMITTER_NAME: "Ada Lovelace", GIT_COMMITTER_EMAIL: "ada@example.com" },
  });
}

/** Creates a repository on branch main whose one commit holds `files`, and pairs it with root `index`. */
export async function repositoryWith(index: number, files: Record<string, string>): Promise<RootRepository> {
  const dir = await folderWith(files);
  git(dir, "init", "--quiet", "--initial-branch=main");
  git(dir, "add", ".");
  git(dir, "commit", "--quiet", "--message", "Add the files");
  return { root: rootAt(index, dir), cwd: dir, repository: { top: dir, prefix: "" } };
}
