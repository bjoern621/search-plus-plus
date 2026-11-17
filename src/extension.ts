import * as vscode from "vscode";
import { textEngine } from "./engines/text";
import { RegexEngine } from "./engines/regex";
import { LanguageIndex, languageContributions } from "./search/languages";
import { EngineRegistry, type StructuralSearchApi } from "./search/registry";
import { findRipgrep } from "./search/ripgrep";
import { SearchRunner } from "./search/runner";
import { SearchViewProvider } from "./searchViewProvider";
import { structuralEngines } from "./structural";

export function activate(context: vscode.ExtensionContext): StructuralSearchApi {
  const log = vscode.window.createOutputChannel("Structural Search", { log: true });
  const rgPath = findRipgrep(vscode.env.appRoot);
  if (!rgPath) log.warn(`No ripgrep found under ${vscode.env.appRoot}, listing files through VS Code without ignore files`);

  const registry = new EngineRegistry();
  registry.register(textEngine);
  for (const engine of structuralEngines()) registry.register(engine);
  let languages: LanguageIndex | undefined;
  const runner = new SearchRunner({
    registry,
    workspaceEngines: [new RegexEngine(rgPath, (message) => log.warn(message))],
    rgPath,
    languages: () => (languages ??= new LanguageIndex(languageContributions(vscode.extensions.all.map((extension) => extension.packageJSON)))),
    log: (message) => log.warn(message),
  });
  const provider = new SearchViewProvider(context.extensionUri, runner);

  context.subscriptions.push(
    log,
    vscode.extensions.onDidChange(() => (languages = undefined)),
    vscode.window.registerWebviewViewProvider(SearchViewProvider.viewId, provider, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand("structuralSearch.focus", () => provider.focus()),
  );
  if (context.extensionMode === vscode.ExtensionMode.Test) registerTestCommands(context, provider);

  return { registerEngine: (engine) => registry.register(engine) };
}

/** Commands that integration tests drive the view with. Other modes never register them. */
function registerTestCommands(context: vscode.ExtensionContext, provider: SearchViewProvider): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("structuralSearch.test.search", (query: string) => provider.testSearch(query)),
    vscode.commands.registerCommand("structuralSearch.test.snapshot", () => provider.testSnapshot()),
    vscode.commands.registerCommand("structuralSearch.test.clickRow", (index: number) => provider.testClickRow(index)),
    vscode.commands.registerCommand("structuralSearch.test.clickHint", () => provider.testClickHint()),
  );
}

export function deactivate(): void {}
