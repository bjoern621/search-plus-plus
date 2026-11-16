import * as vscode from "vscode";
import { SearchViewProvider } from "./searchViewProvider";

export function activate(context: vscode.ExtensionContext): void {
  const provider = new SearchViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SearchViewProvider.viewId, provider),
    vscode.commands.registerCommand("structuralSearch.focus", () => provider.focus()),
  );
}

export function deactivate(): void {}
