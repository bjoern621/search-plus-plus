import * as vscode from "vscode";
import type { HostMessage, ViewMessage } from "./messages";

export class SearchViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = "structuralSearch.view";

  private view: vscode.WebviewView | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist")],
    };
    view.webview.html = renderHtml(view.webview, this.extensionUri);
    view.webview.onDidReceiveMessage((message: ViewMessage) => this.handle(message));
  }

  async focus(): Promise<void> {
    await vscode.commands.executeCommand(`${SearchViewProvider.viewId}.focus`);
    this.post({ type: "focus" });
  }

  private handle(message: ViewMessage): void {
    switch (message.type) {
      case "search":
        this.post({ type: "results", query: message.query, summary: "No search engine handles this query." });
        return;
    }
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
  <input id="query" class="input" aria-label="Search" spellcheck="false">
  <button id="details" class="icon" aria-label="Toggle search details" title="Toggle search details">&#x2026;</button>
</div>
<div id="summary" class="summary"></div>
<div id="results" role="tree" aria-label="Results"></div>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
}

function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64");
}
