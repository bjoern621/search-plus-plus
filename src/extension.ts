import * as vscode from "vscode"
import { textEngine } from "./engines/text"
import { RegexEngine } from "./engines/regex"
import { LanguageIndex, languageContributions } from "./search/languages"
import { EngineRegistry, type SearchPlusPlusApi } from "./search/registry"
import { findRipgrep } from "./search/ripgrep"
import { SearchRunner } from "./search/runner"
import { SearchViewProvider } from "./searchViewProvider"
import { structuralEngines } from "./structural"

/** The settings that the view's menu turns on and off. */
const MENU_TOGGLES = [
    "matchCase",
    "matchWholeWord",
    "umlautVariants",
    "fuzzy",
    "searchIgnoredFiles"
] as const

/** Writes the setting where it holds its value: in the workspace when set there, otherwise in the user settings. */
async function setToggleSetting(
    setting: (typeof MENU_TOGGLES)[number],
    value: boolean
): Promise<void> {
    const settings = vscode.workspace.getConfiguration("searchPlusPlus")
    const target =
        settings.inspect(setting)?.workspaceValue === undefined
            ? vscode.ConfigurationTarget.Global
            : vscode.ConfigurationTarget.Workspace
    await settings.update(setting, value, target)
}

export function activate(context: vscode.ExtensionContext): SearchPlusPlusApi {
    const log = vscode.window.createOutputChannel("Search++", { log: true })
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
                event.affectsConfiguration("searchPlusPlus") ||
                event.affectsConfiguration("files.exclude") ||
                event.affectsConfiguration("search.useParentIgnoreFiles") ||
                event.affectsConfiguration("search.useGlobalIgnoreFiles")
            )
                provider.searchAgain()
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
        vscode.commands.registerCommand("searchPlusPlus.focus", () => provider.focus()),
        vscode.commands.registerCommand("searchPlusPlus.openSettings", () =>
            vscode.commands.executeCommand(
                "workbench.action.openSettings",
                `@ext:${context.extension.id}`
            )
        ),
        vscode.commands.registerCommand("searchPlusPlus.viewAsTree", () =>
            provider.setResultsLayout("tree")
        ),
        vscode.commands.registerCommand("searchPlusPlus.viewAsList", () =>
            provider.setResultsLayout("list")
        ),
        ...MENU_TOGGLES.flatMap((setting) => [
            vscode.commands.registerCommand(`searchPlusPlus.turnOn.${setting}`, () =>
                setToggleSetting(setting, true)
            ),
            vscode.commands.registerCommand(`searchPlusPlus.turnOff.${setting}`, () =>
                setToggleSetting(setting, false)
            )
        ])
    )

    return { registerEngine: (engine) => registry.register(engine) }
}

export function deactivate(): void {}
