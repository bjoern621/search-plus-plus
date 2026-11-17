import * as vscode from "vscode"
import { textEngine } from "./engines/text"
import { RegexEngine } from "./engines/regex"
import { LanguageIndex, languageContributions } from "./search/languages"
import { EngineRegistry, type StructuralSearchApi } from "./search/registry"
import { findRipgrep } from "./search/ripgrep"
import { SearchRunner } from "./search/runner"
import { SearchViewProvider } from "./searchViewProvider"
import { structuralEngines } from "./structural"

export function activate(context: vscode.ExtensionContext): StructuralSearchApi {
    const log = vscode.window.createOutputChannel("Structural Search", { log: true })
    const rgPath = findRipgrep(vscode.env.appRoot)
    if (!rgPath)
        log.warn(`No ripgrep found under ${vscode.env.appRoot}, listing files through VS Code`)

    const registry = new EngineRegistry()
    registry.register(textEngine)
    for (const engine of structuralEngines()) registry.register(engine)
    let languages: LanguageIndex | undefined
    const runner = new SearchRunner({
        registry,
        workspaceEngines: [new RegexEngine(rgPath, (message) => log.warn(message))],
        rgPath,
        languages: () =>
            (languages ??= new LanguageIndex(
                languageContributions(
                    vscode.extensions.all.map((extension) => extension.packageJSON)
                )
            )),
        log: (message) => log.warn(message)
    })
    const provider = new SearchViewProvider(
        context.extensionUri,
        runner,
        (message) => log.error(message),
        context.workspaceState
    )

    context.subscriptions.push(
        log,
        vscode.extensions.onDidChange(() => {
            languages = undefined
            void provider.reloadIconTheme()
        }),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration("workbench.iconTheme")) void provider.reloadIconTheme()
            if (
                event.affectsConfiguration("workbench.tree") ||
                event.affectsConfiguration("search.searchOnType") ||
                event.affectsConfiguration("search.searchOnTypeDebouncePeriod")
            )
                provider.sendSettings()
        }),
        vscode.window.onDidChangeActiveColorTheme(() => provider.applyColorTheme()),
        vscode.window.registerWebviewViewProvider(SearchViewProvider.viewId, provider, {
            webviewOptions: { retainContextWhenHidden: true }
        }),
        vscode.commands.registerCommand("structuralSearch.focus", () => provider.focus()),
        vscode.commands.registerCommand("structuralSearch.openSettings", () =>
            vscode.commands.executeCommand(
                "workbench.action.openSettings",
                `@ext:${context.extension.id}`
            )
        ),
        vscode.commands.registerCommand("structuralSearch.viewAsTree", () =>
            provider.setResultsLayout("tree")
        ),
        vscode.commands.registerCommand("structuralSearch.viewAsList", () =>
            provider.setResultsLayout("list")
        )
    )

    return { registerEngine: (engine) => registry.register(engine) }
}

export function deactivate(): void {}
