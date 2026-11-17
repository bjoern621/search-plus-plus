import * as vscode from "vscode"
import { fileIcons, IconResolver, iconTable } from "./icons/iconTheme"
import {
    activeIconThemeId,
    colorKind,
    iconThemeExtensionFolders,
    type LoadedIconTheme,
    loadIconTheme
} from "./icons/loadIconTheme"
import type {
    FileIcons,
    FileResult,
    HostMessage,
    IconTable,
    ResultsLayout,
    SearchStatus,
    ViewMessage
} from "./messages"
import { assertNever } from "./search/assert"
import { type FileFields, fieldGlobs, NO_FILE_FIELDS } from "./search/globs"
import { RESULT_LINE_LIMIT, TREE_INDENT_MAX_PX, TREE_INDENT_MIN_PX } from "./search/config"
import { parseQuery } from "./query"
import { readSearchText, unsavedTexts } from "./search/reader"
import { splitLines } from "./search/results"
import { searchRoots } from "./search/roots"
import type { SearchRunner } from "./search/runner"
import type { SearchRoot } from "./search/workspaceEngine"

/** The workspace state key of the results layout. */
const RESULTS_LAYOUT_KEY = "resultsLayout"
/** The context key that the View As menu of the view title reads, holding the results layout. */
const RESULTS_LAYOUT_CONTEXT_KEY = "structuralSearch.resultsLayout"
const DEFAULT_RESULTS_LAYOUT: ResultsLayout = "list"

export class SearchViewProvider implements vscode.WebviewViewProvider {
    static readonly viewId = "structuralSearch.view"

    private view: vscode.WebviewView | undefined
    /** Resolves once the script of the current view listens for messages. */
    private viewReady: Promise<void> = new Promise(() => {})
    private markViewReady: () => void = () => {}
    private isViewReady = false
    private searchId = 0
    private running: AbortController | undefined
    private iconTheme: LoadedIconTheme | undefined
    private iconResolver: IconResolver | undefined
    /** Counts the loads of the icon theme, so a slow load never replaces the theme of a later one. */
    private iconThemeLoads = 0
    /** Maps a file URI to a result of the current search, so a theme change can resolve its icons again. */
    private readonly shownFiles = new Map<string, FileResult>()

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly runner: SearchRunner,
        private readonly log: (message: string) => void,
        /** Keeps the results layout per workspace across reloads. */
        private readonly workspaceState: vscode.Memento
    ) {
        this.resetViewReady()
        void this.reloadIconTheme()
        void vscode.commands.executeCommand(
            "setContext",
            RESULTS_LAYOUT_CONTEXT_KEY,
            this.resultsLayout()
        )
    }

    resolveWebviewView(view: vscode.WebviewView): void {
        this.view = view
        if (this.isViewReady) this.resetViewReady()
        view.webview.options = {
            enableScripts: true,
            localResourceRoots: this.resourceRoots()
        }
        view.webview.html = renderHtml(view.webview, this.extensionUri)
        view.webview.onDidReceiveMessage((message: ViewMessage) => this.handle(message))
        view.onDidDispose(() => {
            this.view = undefined
            this.running?.abort()
        })
    }

    async focus(): Promise<void> {
        await vscode.commands.executeCommand(`${SearchViewProvider.viewId}.focus`)
        await this.viewReady
        this.post({ type: "focus" })
    }

    /**
     * Cancels the running search and starts one for `raw` in the files that `fields` pick.
     * Resolves once the new search ends or a newer one replaces it.
     * A search that throws ends as `failed` with a log line, so the view never waits for a search that has stopped.
     */
    async search(raw: string, fields: FileFields = NO_FILE_FIELDS): Promise<void> {
        this.running?.abort()
        const controller = new AbortController()
        this.running = controller
        const searchId = ++this.searchId
        this.shownFiles.clear()
        this.post({ type: "searchStarted", searchId })

        const roots = withExcludeField(searchRoots(), fields.exclude)
        if (raw === "") return this.finish(searchId, "empty")
        if (roots.length === 0) return this.finish(searchId, "noFolder")
        const outcome = await vscode.window
            .withProgress({ location: { viewId: SearchViewProvider.viewId } }, () =>
                this.runner.run({
                    query: parseQuery(raw),
                    roots,
                    contextLines: vscode.workspace
                        .getConfiguration("structuralSearch")
                        .get<number>("contextLines", 1),
                    fields,
                    signal: controller.signal,
                    onBatch: (files) =>
                        this.post({
                            type: "results",
                            searchId,
                            files: files.map((file) => this.withIcons(file))
                        })
                })
            )
            .then(undefined, (error: unknown): { status: "aborted" | "failed" } => {
                if (controller.signal.aborted) return { status: "aborted" }
                this.log(`The search for ${raw} stopped: ${String(error)}`)
                return { status: "failed" }
            })
        switch (outcome.status) {
            case "aborted":
                return
            case "failed":
                return this.finish(searchId, "failed")
            case "blocked":
                this.post({ type: "hint", searchId, hint: outcome.hint })
                return this.finish(searchId, "blocked")
            case "capped":
                return this.finish(searchId, "capped", outcome.limit)
            case "complete":
                return this.finish(searchId, "complete")
            default:
                assertNever(outcome)
        }
    }

    /**
     * Loads the file icon theme that `workbench.iconTheme` names and redraws the icons of the shown results.
     * A theme that fails to load leaves the rows without icons and writes the cause to the output channel.
     */
    async reloadIconTheme(): Promise<void> {
        const load = ++this.iconThemeLoads
        const id = activeIconThemeId()
        const theme =
            id === undefined
                ? undefined
                : await loadIconTheme(id).catch((error: unknown) => {
                      this.log(
                          `The file icon theme ${id} failed to load, showing no icons: ${String(error)}`
                      )
                      return undefined
                  })
        if (load !== this.iconThemeLoads) return
        this.iconTheme = theme
        this.applyColorTheme()
    }

    /** Shows the results as `layout` and keeps the choice for the workspace. */
    setResultsLayout(layout: ResultsLayout): void {
        void this.workspaceState.update(RESULTS_LAYOUT_KEY, layout)
        void vscode.commands.executeCommand("setContext", RESULTS_LAYOUT_CONTEXT_KEY, layout)
        this.post({ type: "resultsLayout", layout })
    }

    private resultsLayout(): ResultsLayout {
        return this.workspaceState.get<ResultsLayout>(RESULTS_LAYOUT_KEY, DEFAULT_RESULTS_LAYOUT)
    }

    /** Sends the workbench and search settings that the view follows. */
    sendSettings(): void {
        const tree = vscode.workspace.getConfiguration("workbench.tree")
        const search = vscode.workspace.getConfiguration("search")
        const indent = Math.min(
            Math.max(tree.get<number>("indent", 8), TREE_INDENT_MIN_PX),
            TREE_INDENT_MAX_PX
        )
        this.post({
            type: "settings",
            settings: {
                treeIndentPx: indent,
                searchOnType: search.get<boolean>("searchOnType", true),
                searchOnTypeDebounceMs: Math.max(
                    search.get<number>("searchOnTypeDebouncePeriod", 300),
                    0
                )
            }
        })
    }

    /** Picks the icons of the `light` or `highContrast` section of the theme for the active color theme and redraws them. */
    applyColorTheme(): void {
        this.iconResolver = this.iconTheme
            ? new IconResolver(
                  this.iconTheme.document,
                  colorKind(vscode.window.activeColorTheme.kind)
              )
            : undefined
        this.sendIcons()
    }

    private finish(searchId: number, status: SearchStatus, limit = RESULT_LINE_LIMIT): void {
        this.post({ type: "searchDone", searchId, status, limit })
    }

    private handle(message: ViewMessage): void {
        switch (message.type) {
            case "ready":
                this.isViewReady = true
                this.markViewReady()
                this.sendIcons()
                this.sendSettings()
                this.post({ type: "resultsLayout", layout: this.resultsLayout() })
                return
            case "search":
                void this.search(message.query, {
                    include: message.include,
                    exclude: message.exclude
                })
                return
            case "cancelSearch":
                this.running?.abort()
                return
            case "open":
                void this.open(message)
                return
            case "copy":
                void vscode.env.clipboard.writeText(message.text)
                return
            case "copyLine":
                void this.copyLine(message.uri, message.line)
                return
            default:
                assertNever(message)
        }
    }

    private async open(message: Extract<ViewMessage, { type: "open" }>): Promise<void> {
        const range = message.range ?? { start: 0, end: 0 }
        await vscode.window.showTextDocument(vscode.Uri.parse(message.uri), {
            selection: new vscode.Range(message.line, range.start, message.line, range.end),
            preview: message.preserveFocus,
            preserveFocus: message.preserveFocus
        })
    }

    /** Copies line `line` of the file as the editor holds it, unsaved changes included. Nothing happens if the file has no such line. */
    private async copyLine(uri: string, line: number): Promise<void> {
        const text = await readSearchText(vscode.Uri.parse(uri), unsavedTexts())
        const lineText = text === undefined ? undefined : splitLines(text)[line]
        if (lineText === undefined) return
        await vscode.env.clipboard.writeText(lineText)
    }

    private withIcons(file: FileResult): FileResult {
        this.shownFiles.set(file.uri, file)
        return { ...file, icons: this.iconsOf(file) }
    }

    private iconsOf(file: FileResult): FileIcons {
        if (!this.iconResolver) return {}
        const root = vscode.workspace.workspaceFolders?.[file.rootIndex]
        const rootFolderName = root ? (root.uri.path.split("/").at(-1) ?? file.root) : file.root
        return fileIcons(this.iconResolver, file, rootFolderName)
    }

    /** Sends the icon table and the icons of every shown file. */
    private sendIcons(): void {
        const view = this.view
        if (!view) return
        if (this.iconTheme && !this.covers(this.iconTheme.extensionFolder)) {
            // The theme comes from an extension installed after the view opened, so the view may load none of its files yet.
            view.webview.options = {
                ...view.webview.options,
                localResourceRoots: this.resourceRoots()
            }
        }
        const files: Record<string, FileIcons> = {}
        for (const [uri, file] of this.shownFiles) files[uri] = this.iconsOf(file)
        this.post({ type: "icons", theme: this.iconTable(view.webview), files })
    }

    private iconTable(webview: vscode.Webview): IconTable | undefined {
        const theme = this.iconTheme
        if (!theme || !this.iconResolver) return undefined
        return iconTable(theme.document, (path) =>
            webview.asWebviewUri(vscode.Uri.joinPath(theme.folder, path)).toString()
        )
    }

    /** The view loads its own script and style and the files of every installed file icon theme, so a theme change keeps the view and its results. */
    private resourceRoots(): vscode.Uri[] {
        return [vscode.Uri.joinPath(this.extensionUri, "dist"), ...iconThemeExtensionFolders()]
    }

    private covers(folder: vscode.Uri): boolean {
        return (this.view?.webview.options.localResourceRoots ?? []).some(
            (root) => root.toString() === folder.toString()
        )
    }

    private resetViewReady(): void {
        this.isViewReady = false
        this.viewReady = new Promise((resolve) => (this.markViewReady = resolve))
    }

    private post(message: HostMessage): void {
        void this.view?.webview.postMessage(message)
    }
}

/** Adds the files to exclude field to the excluded globs of each folder, so the file walk skips those folders. */
function withExcludeField(roots: SearchRoot[], exclude: string): SearchRoot[] {
    const globs = fieldGlobs(exclude)
    if (globs.length === 0) return roots
    return roots.map((root) => ({
        ...root,
        walk: { ...root.walk, excludeGlobs: [...root.walk.excludeGlobs, ...globs] }
    }))
}

function renderHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const nonce = createNonce()
    const script = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", "webview.js"))
    const style = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", "webview.css"))
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; img-src ${webview.cspSource}; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${style}">
</head>
<body>
<div class="query">
  <div class="query-row">
    <div class="query-box">
      <div id="query-highlight" class="query-highlight" aria-hidden="true"></div>
      <input id="query" class="query-input" aria-label="Search" placeholder="Search" spellcheck="false" autocomplete="off">
      <button class="icon clear" data-clears="query" tabindex="-1" aria-label="Clear" title="Clear"><span class="codicon codicon-trash" aria-hidden="true"></span></button>
    </div>
    <button id="details" class="icon" aria-label="Toggle search details" title="Toggle search details" aria-expanded="false" aria-controls="file-fields"><span class="codicon codicon-ellipsis" aria-hidden="true"></span></button>
  </div>
  <div id="file-fields" class="file-fields" hidden>
    <label class="file-field">Files to include<span class="input-box"><input id="include" class="input" spellcheck="false" autocomplete="off" placeholder="Examples: *.yaml, ./charts"><button class="icon clear" data-clears="include" tabindex="-1" aria-label="Clear" title="Clear"><span class="codicon codicon-trash" aria-hidden="true"></span></button></span></label>
    <label class="file-field">Files to exclude<span class="input-box"><input id="exclude" class="input" spellcheck="false" autocomplete="off" placeholder="Examples: ./vendor/, *.lock"><button class="icon clear" data-clears="exclude" tabindex="-1" aria-label="Clear" title="Clear"><span class="codicon codicon-trash" aria-hidden="true"></span></button></span></label>
  </div>
  <div id="hint" class="hint" role="status" hidden></div>
</div>
<div id="summary" class="summary"></div>
<div id="results" class="results" role="tree" aria-label="Results" tabindex="0"><div id="rows" class="rows"></div></div>
<div id="menu" class="menu"></div>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`
}

function createNonce(): string {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    return Buffer.from(bytes).toString("base64")
}
