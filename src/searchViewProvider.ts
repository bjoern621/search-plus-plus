import * as vscode from "vscode";
import type { HostMessage, SearchStatus, TestSnapshot, ViewMessage } from "./messages";
import { assertNever } from "./search/assert";
import { RESULT_LINE_LIMIT } from "./search/config";
import { parseQuery } from "./query";
import { searchRoots } from "./search/roots";
import type { SearchRunner } from "./search/runner";

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

  /** Cancels the running search and starts one for `raw`. Resolves once the new search ends or a newer one replaces it. */
  async search(raw: string): Promise<void> {
    this.running?.abort();
    const controller = new AbortController();
    this.running = controller;
    const searchId = ++this.searchId;
    this.post({ type: "searchStarted", searchId });

    const roots = searchRoots();
    if (raw === "") return this.finish(searchId, "empty");
    if (roots.length === 0) return this.finish(searchId, "noFolder");
    const outcome = await vscode.window.withProgress({ location: { viewId: SearchViewProvider.viewId } }, () =>
      this.runner.run({
        query: parseQuery(raw),
        roots,
        contextLines: vscode.workspace.getConfiguration("structuralSearch").get<number>("contextLines", 1),
        signal: controller.signal,
        onBatch: (files) => this.post({ type: "results", searchId, files }),
      }),
    );
    switch (outcome.status) {
      case "aborted":
        return;
      case "blocked":
        this.post({ type: "hint", searchId, text: outcome.hint });
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
  async testSearch(query: string): Promise<TestSnapshot> {
    await this.focus();
    const done = new Promise<void>((resolve) => {
      const startedAfter = this.searchId;
      const listener = this.searchDone.event((searchId) => {
        if (searchId <= startedAfter) return;
        listener.dispose();
        resolve();
      });
    });
    this.post({ type: "testSearch", query });
    await done;
    return this.testSnapshot();
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

  /** Clicks the result row at `index` of the snapshot rows. For integration tests. */
  async testClickRow(index: number): Promise<void> {
    await this.viewReady;
    this.post({ type: "testClickRow", index });
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
        return;
      case "search":
        void this.search(message.query);
        return;
      case "open":
        void this.open(message);
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

  private resetViewReady(): void {
    this.isViewReady = false;
    this.viewReady = new Promise((resolve) => (this.markViewReady = resolve));
  }

  private post(message: HostMessage): void {
    void this.view?.webview.postMessage(message);
  }
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
    <input id="query" class="input" aria-label="Search" spellcheck="false">
    <button id="details" class="icon" aria-label="Toggle search details" title="Toggle search details">&#x2026;</button>
  </div>
  <div id="hint" class="hint" role="status" hidden></div>
</div>
<div id="summary" class="summary" hidden>
  <span id="summary-text"></span>
  <button id="scope" class="scope" aria-label="Change scope">Working tree &#x25be;</button>
</div>
<div id="results" class="results" role="tree" aria-label="Results"><div id="rows" class="rows"></div></div>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
}

function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64");
}
