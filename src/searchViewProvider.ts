import * as vscode from "vscode";
import { REVISION_SCHEME, type RevisionDocuments } from "./git/revisionDocuments";
import { listBranches } from "./git/repository";
import { describeGit, prepareScope, rootRepositories } from "./git/scopes";
import type { HostMessage, SearchStatus, TestSnapshot, ViewMessage } from "./messages";
import { assertNever } from "./search/assert";
import { type FileFields, fieldGlobs, NO_FILE_FIELDS } from "./search/globs";
import { HOVER_EXCERPT_RADIUS_LINES, RESULT_LINE_LIMIT } from "./search/config";
import { parseQuery } from "./query";
import { readSearchText, unsavedTexts } from "./search/reader";
import { excerptLines, splitLines } from "./search/results";
import { searchRoots } from "./search/roots";
import type { SearchOutcome, SearchRunner } from "./search/runner";
import { type SearchScope, WORKING_TREE } from "./search/scope";
import type { SearchRoot } from "./search/workspaceEngine";

/** How the view reaches Git. */
export interface GitAccess {
  /** The git binary that the Git extension uses, else `git` on the PATH. */
  gitPath: () => string;
  documents: RevisionDocuments;
  log: (message: string) => void;
}

export class SearchViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = "structuralSearch.view";

  private view: vscode.WebviewView | undefined;
  /** Resolves once the script of the current view listens for messages. */
  private viewReady: Promise<void> = new Promise(() => {});
  private markViewReady: () => void = () => {};
  private isViewReady = false;
  private searchId = 0;
  private running: AbortController | undefined;
  private readonly searchDone = new vscode.EventEmitter<number>();
  private readonly snapshots = new vscode.EventEmitter<TestSnapshot>();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly runner: SearchRunner,
    private readonly git: GitAccess,
    private readonly log: (message: string) => void,
  ) {
    this.resetViewReady();
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    if (this.isViewReady) this.resetViewReady();
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist")],
    };
    view.webview.html = renderHtml(view.webview, this.extensionUri);
    view.webview.onDidReceiveMessage((message: ViewMessage) => this.handle(message));
    view.onDidDispose(() => {
      this.view = undefined;
      this.running?.abort();
    });
  }

  async focus(): Promise<void> {
    await vscode.commands.executeCommand(`${SearchViewProvider.viewId}.focus`);
    await this.viewReady;
    this.post({ type: "focus" });
  }

  /** Tells the view whether the Git scopes can run. */
  async sendGitInfo(): Promise<void> {
    const git = await describeGit(this.git.gitPath(), searchRoots());
    this.post({ type: "git", git });
  }

  /**
   * Cancels the running search and starts one for `raw` in the files that `fields` and `scope` pick.
   * Resolves once the new search ends or a newer one replaces it.
   * A search that throws ends as `failed` with a log line, so the view never waits for a search that has stopped.
   */
  async search(raw: string, fields: FileFields = NO_FILE_FIELDS, scope: SearchScope = WORKING_TREE): Promise<void> {
    this.running?.abort();
    const controller = new AbortController();
    this.running = controller;
    const searchId = ++this.searchId;
    this.post({ type: "searchStarted", searchId });

    const roots = withExcludeField(searchRoots(), fields.exclude);
    if (raw === "") return this.finish(searchId, "empty");
    if (roots.length === 0) return this.finish(searchId, "noFolder");
    const outcome = await vscode.window
      .withProgress({ location: { viewId: SearchViewProvider.viewId } }, async (): Promise<SearchOutcome | { status: "noRepository" }> => {
        const prepared = await prepareScope(this.git.gitPath(), scope, roots, controller.signal, this.git.log);
        if (controller.signal.aborted) return { status: "aborted" };
        if (prepared.kind === "noRepository") return { status: "noRepository" };
        return this.runner.run({
          query: parseQuery(raw),
          files: prepared.files,
          roots,
          contextLines: vscode.workspace.getConfiguration("structuralSearch").get<number>("contextLines", 1),
          fields,
          signal: controller.signal,
          onBatch: (files) => this.post({ type: "results", searchId, files }),
        });
      })
      .then(undefined, (error: unknown): { status: "aborted" | "failed" } => {
        if (controller.signal.aborted) return { status: "aborted" };
        this.log(`The search for ${raw} stopped: ${String(error)}`);
        return { status: "failed" };
      });
    switch (outcome.status) {
      case "aborted":
        return;
      case "failed":
        return this.finish(searchId, "failed");
      case "noRepository":
        return this.finish(searchId, "noRepository");
      case "blocked":
        this.post({ type: "hint", searchId, hint: outcome.hint });
        return this.finish(searchId, "blocked");
      case "capped":
        return this.finish(searchId, "capped", outcome.limit);
      case "complete":
        return this.finish(searchId, "complete");
      default:
        assertNever(outcome);
    }
  }

  /** Types `query` into the view and presses Enter, then returns what the view shows once the search ends. For integration tests. */
  async testSearch(query: string, fields?: FileFields, scope?: SearchScope): Promise<TestSnapshot> {
    await this.focus();
    return this.afterSearch({ type: "testSearch", query, fields, scope });
  }

  /** Clicks the scope button, then returns what the view shows. For integration tests. */
  async testOpenScopeMenu(): Promise<TestSnapshot> {
    await this.viewReady;
    this.post({ type: "testOpenScopeMenu" });
    return this.testSnapshot();
  }

  /** Clicks the exclude button of the folder or file row at `index`, then returns what the view shows. For integration tests. */
  async testExcludeRow(index: number): Promise<TestSnapshot> {
    await this.viewReady;
    this.post({ type: "testExcludeRow", index });
    return this.testSnapshot();
  }

  /**
   * Types `fields` into the files to include and exclude fields, then returns what the view shows.
   * With `startsSearch`, it returns once the search that the typing starts ends. For integration tests.
   */
  async testTypeFileFields(fields: FileFields, startsSearch: boolean): Promise<TestSnapshot> {
    await this.viewReady;
    if (startsSearch) return this.afterSearch({ type: "testTypeFileFields", ...fields });
    this.post({ type: "testTypeFileFields", ...fields });
    return this.testSnapshot();
  }

  /** Clicks the hint line, then returns what the view shows once the suggested search ends. For integration tests. */
  async testClickHint(): Promise<TestSnapshot> {
    await this.viewReady;
    return this.afterSearch({ type: "testClickHint" });
  }

  /** Returns the summary, the hint and every result row as the view holds them. For integration tests. */
  async testSnapshot(): Promise<TestSnapshot> {
    await this.viewReady;
    const snapshot = new Promise<TestSnapshot>((resolve) => {
      const listener = this.snapshots.event((value) => {
        listener.dispose();
        resolve(value);
      });
    });
    this.post({ type: "testSnapshot" });
    return snapshot;
  }

  /** Presses `keys` on the results one after another, then returns what the view shows. A key such as `Shift+F10` holds Shift. For integration tests. */
  async testPressKeys(keys: string[]): Promise<TestSnapshot> {
    await this.viewReady;
    this.post({ type: "testPressKeys", keys });
    return this.testSnapshot();
  }

  /** Right-clicks the row at `index` of the snapshot rows, then returns what the view shows. For integration tests. */
  async testOpenMenu(index: number): Promise<TestSnapshot> {
    await this.viewReady;
    this.post({ type: "testOpenMenu", index });
    return this.testSnapshot();
  }

  /** Rests the pointer on the row at `index` of the snapshot rows. For integration tests. */
  async testHover(index: number): Promise<void> {
    await this.viewReady;
    this.post({ type: "testHover", index });
  }

  /** Clicks the item labelled `label` in the open context menu, then returns what the view shows. For integration tests. */
  async testChooseMenuItem(label: string): Promise<TestSnapshot> {
    await this.viewReady;
    this.post({ type: "testChooseMenuItem", label });
    return this.testSnapshot();
  }

  /** Clicks the item labelled `label` in the open context menu, then returns what the view shows once the search that it starts ends. For integration tests. */
  async testChooseMenuSearch(label: string): Promise<TestSnapshot> {
    await this.viewReady;
    return this.afterSearch({ type: "testChooseMenuItem", label });
  }

  /** Clicks the result row at `index` of the snapshot rows. For integration tests. */
  async testClickRow(index: number): Promise<void> {
    await this.viewReady;
    this.post({ type: "testClickRow", index });
  }

  /** Posts `action`, waits for the search that it starts to end and returns the snapshot. */
  private async afterSearch(action: HostMessage): Promise<TestSnapshot> {
    const done = new Promise<void>((resolve) => {
      const startedAfter = this.searchId;
      const listener = this.searchDone.event((searchId) => {
        if (searchId <= startedAfter) return;
        listener.dispose();
        resolve();
      });
    });
    this.post(action);
    await done;
    return this.testSnapshot();
  }

  private finish(searchId: number, status: SearchStatus, limit = RESULT_LINE_LIMIT): void {
    this.post({ type: "searchDone", searchId, status, limit });
    this.searchDone.fire(searchId);
  }

  private handle(message: ViewMessage): void {
    switch (message.type) {
      case "ready":
        this.isViewReady = true;
        this.markViewReady();
        void this.sendGitInfo();
        return;
      case "search":
        void this.search(message.query, { include: message.include, exclude: message.exclude }, message.scope);
        return;
      case "pickBranch":
        void this.pickBranch();
        return;
      case "open":
        void this.open(message);
        return;
      case "copy":
        void vscode.env.clipboard.writeText(message.text);
        return;
      case "copyLine":
        void this.copyLine(message.uri, message.line);
        return;
      case "excerpt":
        void this.sendExcerpt(message.requestId, message.uri, message.line);
        return;
      case "testSnapshot":
        this.snapshots.fire(message.snapshot);
        return;
      default:
        assertNever(message);
    }
  }

  private async open(message: Extract<ViewMessage, { type: "open" }>): Promise<void> {
    const range = message.range ?? { start: 0, end: 0 };
    await vscode.window.showTextDocument(vscode.Uri.parse(message.uri), {
      selection: new vscode.Range(message.line, range.start, message.line, range.end),
      preview: message.preserveFocus,
      preserveFocus: message.preserveFocus,
    });
  }

  /** Shows the branches of the first workspace folder in a repository and sends the one that the person picks. Nothing happens on cancel. */
  private async pickBranch(): Promise<void> {
    const [first] = await rootRepositories(this.git.gitPath(), searchRoots());
    const branches = first ? await listBranches(this.git.gitPath(), first.cwd).catch(() => []) : [];
    const items = branches.map((branch) => ({ label: branch.name, description: branch.relativeDate, detail: branch.subject }));
    const picked = await vscode.window.showQuickPick(items, {
      title: "Search a branch",
      placeHolder: items.length === 0 ? "No other branch to search" : "Pick a branch to search",
      matchOnDetail: true,
    });
    if (picked) this.post({ type: "branchPicked", branch: picked.label });
  }

  /** Reads a file of the working tree as the editor holds it, unsaved changes included, or a file that a branch or commit holds. */
  private readText(uri: vscode.Uri): Promise<string | undefined> {
    if (uri.scheme === REVISION_SCHEME) return this.git.documents.read(uri);
    return readSearchText(uri, unsavedTexts());
  }

  /** Copies line `line` of the file as the editor holds it, unsaved changes included. Nothing happens if the file has no such line. */
  private async copyLine(uri: string, line: number): Promise<void> {
    const text = await this.readText(vscode.Uri.parse(uri));
    const lineText = text === undefined ? undefined : splitLines(text)[line];
    if (lineText === undefined) return;
    await vscode.env.clipboard.writeText(lineText);
  }

  private async sendExcerpt(requestId: number, uri: string, line: number): Promise<void> {
    const text = await this.readText(vscode.Uri.parse(uri));
    const lines = text === undefined ? [] : excerptLines(splitLines(text), line, HOVER_EXCERPT_RADIUS_LINES);
    this.post({ type: "excerpt", requestId, lines });
  }

  private resetViewReady(): void {
    this.isViewReady = false;
    this.viewReady = new Promise((resolve) => (this.markViewReady = resolve));
  }

  private post(message: HostMessage): void {
    void this.view?.webview.postMessage(message);
  }
}

/** Adds the files to exclude field to the excluded globs of each folder, so the file walk skips those folders. */
function withExcludeField(roots: SearchRoot[], exclude: string): SearchRoot[] {
  const globs = fieldGlobs(exclude);
  if (globs.length === 0) return roots;
  return roots.map((root) => ({ ...root, walk: { ...root.walk, excludeGlobs: [...root.walk.excludeGlobs, ...globs] } }));
}

function renderHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = createNonce();
  const script = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", "webview.js"));
  const style = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", "webview.css"));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${style}">
</head>
<body>
<div class="query">
  <div class="query-row">
    <div class="query-box">
      <div id="query-highlight" class="query-highlight" aria-hidden="true"></div>
      <input id="query" class="query-input" aria-label="Search" spellcheck="false" autocomplete="off">
    </div>
    <button id="details" class="icon" aria-label="Toggle search details" title="Toggle search details" aria-expanded="false" aria-controls="file-fields">&#x2026;</button>
  </div>
  <div id="file-fields" class="file-fields" hidden>
    <label class="file-field">Files to include<input id="include" class="input" spellcheck="false" autocomplete="off" placeholder="For example *.yaml, ./charts"></label>
    <label class="file-field">Files to exclude<input id="exclude" class="input" spellcheck="false" autocomplete="off" placeholder="For example ./vendor/, *.lock"></label>
  </div>
  <div id="hint" class="hint" role="status" hidden></div>
</div>
<div id="summary" class="summary" hidden>
  <span id="summary-text"></span>
  <button id="scope" class="scope" aria-label="Change scope">Working tree &#x25be;</button>
</div>
<div id="results" class="results" role="tree" aria-label="Results" tabindex="0"><div id="rows" class="rows"></div></div>
<div id="menu" class="menu"></div>
<div id="hover" class="hover" hidden></div>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
}

function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64");
}
