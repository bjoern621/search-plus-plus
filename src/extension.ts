import * as vscode from "vscode";
import { textEngine } from "./engines/text";
import { RegexEngine } from "./engines/regex";
import { REVISION_SCHEME, RevisionDocuments } from "./git/revisionDocuments";
import { LanguageIndex, languageContributions } from "./search/languages";
import { EngineRegistry, type StructuralSearchApi } from "./search/registry";
import { findRipgrep } from "./search/ripgrep";
import { SearchRunner } from "./search/runner";
import { SearchViewProvider } from "./searchViewProvider";
import { structuralEngines } from "./structural";

export function activate(context: vscode.ExtensionContext): StructuralSearchApi {
  const log = vscode.window.createOutputChannel("Structural Search", { log: true });
  const rgPath = findRipgrep(vscode.env.appRoot);
  if (!rgPath) log.warn(`No ripgrep found under ${vscode.env.appRoot}, listing files through VS Code`);

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
  const documents = new RevisionDocuments(gitPath);
  const provider = new SearchViewProvider(context.extensionUri, runner, { gitPath, documents, log: (message) => log.warn(message) }, (message) => log.error(message));

  context.subscriptions.push(
    log,
    vscode.extensions.onDidChange(() => {
      languages = undefined;
      void provider.reloadIconTheme();
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("workbench.iconTheme")) void provider.reloadIconTheme();
      if (event.affectsConfiguration("workbench.tree") || event.affectsConfiguration("search.searchOnType") || event.affectsConfiguration("search.searchOnTypeDebouncePeriod")) provider.sendSettings();
    }),
    vscode.window.onDidChangeActiveColorTheme(() => provider.applyColorTheme()),
    vscode.window.registerWebviewViewProvider(SearchViewProvider.viewId, provider, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand("structuralSearch.focus", () => provider.focus()),
    vscode.workspace.registerTextDocumentContentProvider(REVISION_SCHEME, documents),
    vscode.workspace.onDidChangeWorkspaceFolders(() => void provider.sendGitInfo()),
  );

  return { registerEngine: (engine) => registry.register(engine) };
}

interface GitExtensionApi {
  getAPI(version: 1): { git: { path: string } };
}

/** The git binary that the built-in Git extension found, else `git` on the PATH. Activates no extension. */
function gitPath(): string {
  const extension = vscode.extensions.getExtension<GitExtensionApi>("vscode.git");
  if (!extension?.isActive) return "git";
  try {
    return extension.exports.getAPI(1).git.path;
  } catch {
    return "git";
  }
}

export function deactivate(): void {}
