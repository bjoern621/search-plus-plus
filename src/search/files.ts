import * as vscode from "vscode";
import { expandBraces } from "./globs";
import { runRipgrep } from "./ripgrep";
import { ripgrepWalkArgs, WalkExcludes } from "./walk";
import type { SearchRoot } from "./workspaceEngine";

export interface RootFile {
  root: SearchRoot;
  /** Relative to the root, with `/` as separator. */
  relativePath: string;
}

/**
 * Lists the files of every root that the exclude settings and ignore files leave in.
 * A root on disk gets listed by ripgrep. Without ripgrep, or on another file system, `workspace.findFiles` lists it.
 * `findFiles` honors the exclude settings but no ignore files.
 * A root that cannot be listed, such as a folder deleted since the workspace opened, adds no files and a log line.
 */
export async function collectFiles(roots: readonly SearchRoot[], rgPath: string | undefined, signal: AbortSignal, log: (message: string) => void): Promise<RootFile[]> {
  const lists = await Promise.all(
    roots.map((root) =>
      listRoot(root, rgPath, signal, log).catch((error: unknown) => {
        if (!signal.aborted) log(`Could not list the files of ${root.uri}: ${String(error)}`);
        return [];
      }),
    ),
  );
  return lists.flat();
}

function listRoot(root: SearchRoot, rgPath: string | undefined, signal: AbortSignal, log: (message: string) => void): Promise<RootFile[]> {
  return rgPath && root.fsPath !== undefined ? listWithRipgrep(rgPath, root, root.fsPath, signal, log) : listWithFindFiles(root, signal);
}

async function listWithRipgrep(rgPath: string, root: SearchRoot, cwd: string, signal: AbortSignal, log: (message: string) => void): Promise<RootFile[]> {
  const files: RootFile[] = [];
  const toSlash = process.platform === "win32" ? (path: string) => path.replace(/\\/g, "/") : (path: string) => path;
  const exit = await runRipgrep(rgPath, ["--files", ...ripgrepWalkArgs(root.walk)], {
    cwd,
    signal,
    onLine: (line) => files.push({ root, relativePath: toSlash(line) }),
  });
  if (exit.code === 2) log(`ripgrep could not list every file in ${cwd}: ${exit.stderr.trim()}`);
  return files;
}

async function listWithFindFiles(root: SearchRoot, signal: AbortSignal): Promise<RootFile[]> {
  const rootUri = vscode.Uri.parse(root.uri);
  // findFiles takes one exclude glob. A brace group joins the patterns, and VS Code globs cannot nest braces.
  // A glob with a brace left after the expansion, such as a `{` without its `}`, gets tested on the listed paths.
  const globs = root.walk.excludeGlobs.flatMap(expandBraces);
  const flat = globs.filter((glob) => !/[{}]/.test(glob));
  const leftover = new WalkExcludes(globs.filter((glob) => /[{}]/.test(glob)));
  const exclude = flat.length > 0 ? `{${flat.join(",")}}` : undefined;
  const cancellation = new vscode.CancellationTokenSource();
  const onAbort = () => cancellation.cancel();
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(rootUri, "**/*"), exclude, undefined, cancellation.token);
    const prefix = rootUri.path.endsWith("/") ? rootUri.path : `${rootUri.path}/`;
    return uris
      .filter((uri) => uri.path.startsWith(prefix))
      .map((uri) => ({ root, relativePath: uri.path.slice(prefix.length) }))
      .filter((file) => !leftover.excludes(file.relativePath));
  } catch (error) {
    if (signal.aborted) return [];
    throw error;
  } finally {
    signal.removeEventListener("abort", onAbort);
    cancellation.dispose();
  }
}
