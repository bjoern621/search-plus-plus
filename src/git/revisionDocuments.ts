import * as path from "node:path";
import * as vscode from "vscode";
import { runGit } from "./cli";

/** The URI scheme of a file as a branch or commit holds it. Editors show such a file read-only. */
export const REVISION_SCHEME = "structural-search-git";

interface RevisionQuery {
  /** The top folder of the work tree. */
  top: string;
  /** A branch name or a commit hash. */
  ref: string;
  /** Relative to `top`, with `/` as separator. */
  path: string;
}

/**
 * Builds the URI of the file at `repoPath` as `ref` holds it.
 * The path of the URI matches the file on disk, so the editor picks its language and names its tab after the file.
 */
export function revisionUri(top: string, ref: string, repoPath: string): vscode.Uri {
  const query: RevisionQuery = { top, ref, path: repoPath };
  return vscode.Uri.file(path.join(top, repoPath)).with({ scheme: REVISION_SCHEME, query: JSON.stringify(query) });
}

function parseRevisionUri(uri: vscode.Uri): RevisionQuery | undefined {
  try {
    const query = JSON.parse(uri.query) as Partial<RevisionQuery>;
    if (typeof query.top !== "string" || typeof query.ref !== "string" || typeof query.path !== "string") return undefined;
    return { top: query.top, ref: query.ref, path: query.path };
  } catch {
    return undefined;
  }
}

/** Serves the text of a file at a revision, so search results from a branch or a commit open in a read-only editor. */
export class RevisionDocuments implements vscode.TextDocumentContentProvider {
  constructor(private readonly gitPath: () => string) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const text = await this.read(uri);
    if (text === undefined) throw new Error(`Git holds no file at ${uri.query}`);
    return text;
  }

  /** Returns the text of the file that `uri` names. Undefined when git cannot read it. */
  async read(uri: vscode.Uri): Promise<string | undefined> {
    const query = parseRevisionUri(uri);
    if (!query) return undefined;
    const exit = await runGit(this.gitPath(), ["cat-file", "blob", `${query.ref}:${query.path}`], { cwd: query.top }).catch(() => undefined);
    if (!exit || exit.code !== 0) return undefined;
    return new TextDecoder("utf-8").decode(exit.stdout);
  }
}
