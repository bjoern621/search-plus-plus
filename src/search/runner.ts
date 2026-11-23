import * as path from "node:path"
import * as vscode from "vscode"
import type { FileResult } from "../messages"
import { PathWords } from "../query/pathWords"
import type { Hint } from "../query/types"
import { assert } from "./assert"
import { BatchSender } from "./batch"
import { BATCH_INTERVAL_DURATION_MS, FILE_READ_CONCURRENCY, RESULT_LINE_LIMIT } from "./config"
import { collectFiles, relistReused } from "./files"
import { type FileFields, PathFilter } from "./globs"
import type { LanguageIndex } from "./languages"
import { LineFeedLineMap } from "./lineFeedLines"
import { readSearchText, unsavedTexts } from "./reader"
import type { EngineRegistry } from "./registry"
import { buildFileResult, fileMatches, splitLines } from "./results"
import type { FileInfo, LineMatch, Query, SearchEngine } from "./types"
import type { PoolSearch, SearchWorkerPool } from "./worker/pool"
import type { SearchRoot, WorkspaceSearchEngine } from "./workspaceEngine"

export type SearchOutcome =
    | { status: "complete" }
    | { status: "capped"; limit: number }
    | { status: "blocked"; hint: Hint }
    | { status: "aborted" }

export interface SearchRunnerDeps {
    registry: EngineRegistry
    workspaceEngines: readonly WorkspaceSearchEngine[]
    rgPath: string | undefined
    languages: () => LanguageIndex
    log: (message: string) => void
    /** Searches files on disk in worker threads. Without it, every file gets searched in the extension host. */
    workers?: SearchWorkerPool
}

/** A file that an editor tab shows. */
export interface OpenFile {
    uri: string
    /** The path that the results show, with `/` as separator. */
    relativePath: string
}

export interface SearchRequest {
    query: Query
    roots: readonly SearchRoot[]
    /** Files searched beside the roots, such as the open editors of a window without a workspace folder. Missing means none. */
    openFiles?: readonly OpenFile[]
    contextLines: number
    /** The search stops once this many lines matched. Missing means `RESULT_LINE_LIMIT`. */
    resultLineLimit?: number
    /** The files to include and exclude fields of the view. */
    fields: FileFields
    signal: AbortSignal
    /** Receives results in batches, each file once. */
    onBatch: (files: FileResult[]) => void
}

/** A file to search and the matches that a workspace engine found in it. */
interface PendingFile {
    root: SearchRoot
    relativePath: string
    lists: LineMatch[][]
}

export class SearchRunner {
    constructor(private readonly deps: SearchRunnerDeps) {}

    /**
     * Runs the query in every engine that accepts it and streams the merged results.
     * Stops after `request.resultLineLimit` matched lines.
     * Aborting the signal ends the search without a final batch.
     */
    async run(request: SearchRequest): Promise<SearchOutcome> {
        const workspaceEngines = this.deps.workspaceEngines.filter((engine) =>
            engine.acceptsQuery(request.query)
        )
        const hint = await this.firstHint(workspaceEngines, request)
        if (request.signal.aborted) return { status: "aborted" }
        if (hint !== undefined) return { status: "blocked", hint }

        const search = new RunningSearch(
            this.deps,
            request,
            this.deps.registry.list(),
            workspaceEngines
        )
        await search.run()
        if (request.signal.aborted) return { status: "aborted" }
        return search.capped
            ? { status: "capped", limit: request.resultLineLimit ?? RESULT_LINE_LIMIT }
            : { status: "complete" }
    }

    private async firstHint(
        engines: readonly WorkspaceSearchEngine[],
        request: SearchRequest
    ): Promise<Hint | undefined> {
        for (const engine of engines) {
            const hint = await engine.check(request.query, request.signal)
            if (hint !== undefined) return hint
        }
        return undefined
    }
}

/** The state of one search from its start to its last batch. */
class RunningSearch {
    capped = false
    private matchedLines = 0
    private readonly stop = new AbortController()
    private readonly signal: AbortSignal
    private readonly sender: BatchSender<FileResult>
    private readonly unsaved = unsavedTexts()
    private readonly languages: LanguageIndex
    private readonly pathWords: PathWords

    constructor(
        private readonly deps: SearchRunnerDeps,
        private readonly request: SearchRequest,
        private readonly fileEngines: readonly SearchEngine[],
        private readonly workspaceEngines: readonly WorkspaceSearchEngine[]
    ) {
        this.signal = AbortSignal.any([request.signal, this.stop.signal])
        this.sender = new BatchSender((files) => {
            if (!request.signal.aborted) request.onBatch(files)
        }, BATCH_INTERVAL_DURATION_MS)
        this.languages = deps.languages()
        this.pathWords = new PathWords(request.query)
        assert(
            workspaceEngines.length <= 1,
            "at most one workspace engine may accept a query, since the search takes up each file once"
        )
    }

    async run(): Promise<void> {
        const takenUris = new Set<string>()
        await this.searchDisk(takenUris)
        await this.searchOpenFiles(takenUris)
        this.sender.flush()
        relistReused(this.deps.rgPath, this.deps.log)
    }

    /**
     * Searches a file once the workspace engine reports it, so its results show while the engine walks on.
     * A file that the workspace engine found but the file list left out still shows.
     * The other listed files follow once the workspace engine ends.
     * The workspace engine reads a file with unsaved changes from disk, so its text in the editor gets searched in place of what the engine reports.
     */
    private async searchDisk(takenUris: Set<string>): Promise<void> {
        if (this.request.roots.length === 0) return
        const fieldFilter = new PathFilter(this.request.fields)
        const queue = new WorkQueue(FILE_READ_CONCURRENCY, this.signal)
        const workers = this.deps.workers?.start(
            this.request.query,
            this.request.contextLines,
            this.signal
        )
        // Nested workspace folders list a file twice.
        const take = (item: PendingFile) => {
            if (!fieldFilter.accepts(item.relativePath)) return
            const uri = this.fileUri(item.root, item.relativePath)
            if (takenUris.has(uri)) return
            takenUris.add(uri)
            this.dispatch(item, uri, queue, workers)
        }
        try {
            await this.takeFiles(take, fieldFilter)
        } finally {
            await workers?.drained()
            await queue.drained()
        }
    }

    /** Searches the open files that the roots left out, in the text that their editors hold. */
    private async searchOpenFiles(takenUris: ReadonlySet<string>): Promise<void> {
        const fieldFilter = new PathFilter(this.request.fields)
        const files = (this.request.openFiles ?? []).filter(
            (file) => !takenUris.has(file.uri) && fieldFilter.accepts(file.relativePath)
        )
        const read = await Promise.all(
            files.map(async (file) => ({
                file,
                text: await readSearchText(vscode.Uri.parse(file.uri), this.unsaved)
            }))
        )
        const readable = read.flatMap(({ file, text }) =>
            text === undefined ? [] : [{ file, text }]
        )
        if (readable.length === 0 || this.signal.aborted) return
        const found = await this.searchTextsWithWorkspaceEngines(readable.map((item) => item.text))
        for (const [index, { file, text }] of readable.entries()) {
            const info: FileInfo = {
                uri: file.uri,
                relativePath: file.relativePath,
                languageId: this.languageOf(file.relativePath)
            }
            const lists = workspaceEditorLines(
                text,
                found.map((engineLists) => engineLists[index] ?? [])
            )
            const query = this.pathWords.queryFor(file.relativePath)
            for (const engine of this.fileEngines.filter((engine) =>
                this.accepts(engine, info, query)
            )) {
                const matches = await this.searchWith(engine, { ...info, text }, query)
                if (matches) lists.push(matches)
            }
            this.emitFound(OPEN_FILES_ROOT, info, text, lists)
        }
    }

    private async takeFiles(
        take: (item: PendingFile) => void,
        fieldFilter: PathFilter
    ): Promise<void> {
        if (this.workspaceEngines.length === 0) {
            // Each file gets searched once listed, since no file waits for the matches of a workspace engine.
            await collectFiles(
                this.request.roots,
                this.deps.rgPath,
                this.signal,
                this.deps.log,
                (file) => take({ root: file.root, relativePath: file.relativePath, lists: [] })
            )
            return
        }
        const [files] = await Promise.all([
            collectFiles(this.request.roots, this.deps.rgPath, this.signal, this.deps.log),
            this.runWorkspaceEngines((root, relativePath, matches) => {
                if (!this.unsaved.has(this.fileUri(root, relativePath)))
                    take({ root, relativePath, lists: [matches] })
            })
        ])
        const unsaved = files.flatMap((file) => {
            const text = this.unsaved.get(this.fileUri(file.root, file.relativePath))
            return text === undefined || !fieldFilter.accepts(file.relativePath)
                ? []
                : [{ file, text }]
        })
        if (unsaved.length > 0) {
            const found = await this.searchTextsWithWorkspaceEngines(
                unsaved.map((item) => item.text)
            )
            unsaved.forEach(({ file }, index) =>
                take({
                    root: file.root,
                    relativePath: file.relativePath,
                    lists: found.map((lists) => lists[index] ?? [])
                })
            )
        }
        for (const file of files)
            take({ root: file.root, relativePath: file.relativePath, lists: [] })
    }

    /** Hands a file to the workers where they can search it, else to `queue`. */
    private dispatch(
        item: PendingFile,
        uri: string,
        queue: WorkQueue,
        workers: PoolSearch | undefined
    ): void {
        const file: FileInfo = {
            uri,
            relativePath: item.relativePath,
            languageId: this.languageOf(item.relativePath)
        }
        const query = this.pathWords.queryFor(item.relativePath)
        const engines = this.fileEngines.filter((engine) => this.accepts(engine, file, query))
        if (engines.length === 0 && item.lists.length === 0) return
        const inThread = () =>
            queue.add(() =>
                this.searchFile(item, file, engines, query).catch((error: unknown) =>
                    this.deps.log(`Could not search ${item.relativePath}: ${String(error)}`)
                )
            )
        const fsPath = workers && this.workerPath(item, uri, engines)
        if (workers === undefined || fsPath === undefined) {
            inThread()
            return
        }
        workers.add(
            { fsPath, info: file, engineIds: engines.map((engine) => engine.id) },
            (lines, matches) => this.emit(item.root, file, lines, matches),
            inThread
        )
    }

    /** The path on disk of a file that the workers can search: no workspace engine matched it, no editor holds unsaved changes and the workers run every engine that accepts it. */
    private workerPath(
        item: PendingFile,
        uri: string,
        engines: readonly SearchEngine[]
    ): string | undefined {
        const workers = this.deps.workers
        if (workers === undefined || item.root.fsPath === undefined) return undefined
        if (item.lists.length > 0 || engines.length === 0 || this.unsaved.has(uri)) return undefined
        if (!engines.every((engine) => workers.engineIds.has(engine.id))) return undefined
        return path.join(item.root.fsPath, item.relativePath)
    }

    /** Returns per workspace engine the matches of each text in `texts`. */
    private async searchTextsWithWorkspaceEngines(
        texts: readonly string[]
    ): Promise<LineMatch[][][]> {
        return Promise.all(
            this.workspaceEngines.map((engine) =>
                engine
                    .searchTexts(texts, this.request.query, this.signal)
                    .catch((error: unknown) => {
                        if (!this.signal.aborted)
                            this.deps.log(
                                `Search engine ${engine.id} could not finish: ${String(error)}`
                            )
                        return []
                    })
            )
        )
    }

    private async runWorkspaceEngines(
        onFile: (root: SearchRoot, relativePath: string, matches: LineMatch[]) => void
    ): Promise<void> {
        await Promise.all(
            this.workspaceEngines.map(async (engine) => {
                try {
                    await engine.search(this.request.roots, this.request.query, this.signal, onFile)
                } catch (error) {
                    if (!this.signal.aborted)
                        this.deps.log(
                            `Search engine ${engine.id} could not finish: ${String(error)}`
                        )
                }
            })
        )
    }

    private async searchFile(
        item: PendingFile,
        file: FileInfo,
        engines: readonly SearchEngine[],
        query: Query
    ): Promise<void> {
        const text = await readSearchText(vscode.Uri.parse(file.uri), this.unsaved)
        if (text === undefined || this.signal.aborted) return

        const lists = workspaceEditorLines(text, item.lists)
        for (const engine of engines) {
            const found = await this.searchWith(engine, { ...file, text }, query)
            if (found) lists.push(found)
        }
        this.emitFound(item.root, file, text, lists)
    }

    private emitFound(
        root: ResultRoot,
        file: FileInfo,
        text: string,
        lists: readonly LineMatch[][]
    ): void {
        if (this.signal.aborted || lists.every((list) => list.length === 0)) return
        const { lines, matches } = fileMatches(splitLines(text), lists)
        this.emit(root, file, lines, matches)
    }

    private languageOf(relativePath: string): string {
        return this.languages.languageOf(relativePath.slice(relativePath.lastIndexOf("/") + 1))
    }

    /** `lines` must hold the lines that `buildFileResult` reads for `merged`. */
    private emit(
        root: ResultRoot,
        file: FileInfo,
        lines: readonly string[],
        merged: readonly LineMatch[]
    ): void {
        const limit = this.request.resultLineLimit ?? RESULT_LINE_LIMIT
        const room = limit - this.matchedLines
        if (merged.length === 0 || room <= 0 || this.signal.aborted) return
        const kept = merged.slice(0, room)
        this.matchedLines += kept.length
        if (this.matchedLines >= limit) {
            this.capped = true
            this.stop.abort()
        }
        const place = {
            rootIndex: root.index,
            root: root.name,
            uri: file.uri,
            relativePath: file.relativePath,
            languageId: file.languageId
        }
        this.sender.push(buildFileResult(place, lines, kept, this.request.contextLines))
    }

    private accepts(engine: SearchEngine, file: FileInfo, query: Query): boolean {
        try {
            return engine.accepts(file, query)
        } catch (error) {
            this.deps.log(
                `Search engine ${engine.id} could not decide on ${file.relativePath}: ${String(error)}`
            )
            return false
        }
    }

    private async searchWith(
        engine: SearchEngine,
        file: FileInfo & { text: string },
        query: Query
    ): Promise<LineMatch[] | undefined> {
        try {
            return await engine.search(file, query, this.signal)
        } catch (error) {
            if (!this.signal.aborted)
                this.deps.log(
                    `Search engine ${engine.id} could not search ${file.relativePath}: ${String(error)}`
                )
            return undefined
        }
    }

    private fileUri(root: SearchRoot, relativePath: string): string {
        return vscode.Uri.joinPath(vscode.Uri.parse(root.uri), relativePath).toString()
    }
}

/** The workspace folder that a result names. */
type ResultRoot = Pick<SearchRoot, "index" | "name">

/** Open files belong to no workspace folder. They show as files of one unnamed root. */
const OPEN_FILES_ROOT: ResultRoot = { index: 0, name: "" }

/** Moves the matches of workspace engines, which count lines as ripgrep does, to the lines of the editor. */
function workspaceEditorLines(text: string, lists: readonly LineMatch[][]): LineMatch[][] {
    if (lists.length === 0) return []
    const lineFeeds = new LineFeedLineMap(text)
    return lists.map((list) => lineFeeds.toEditorLines(list))
}

/** Runs added work at most `limit` at a time. Drops the waiting work once `signal` aborts. */
class WorkQueue {
    private readonly waiting: (() => Promise<void>)[] = []
    /** The index in `waiting` of the work that starts next. */
    private next = 0
    private readonly running = new Set<Promise<void>>()

    constructor(
        private readonly limit: number,
        private readonly signal: AbortSignal
    ) {}

    /** `work` must not reject. */
    add(work: () => Promise<void>): void {
        if (this.signal.aborted) return
        this.waiting.push(work)
        this.startWaiting()
    }

    /** Resolves once every work that started has ended. */
    async drained(): Promise<void> {
        while (this.running.size > 0) await Promise.all(this.running)
    }

    private startWaiting(): void {
        while (
            this.running.size < this.limit &&
            this.next < this.waiting.length &&
            !this.signal.aborted
        ) {
            const work = this.waiting[this.next++]!
            const running = work().finally(() => {
                this.running.delete(running)
                this.startWaiting()
            })
            this.running.add(running)
        }
        if (this.next === this.waiting.length || this.signal.aborted) {
            this.waiting.length = 0
            this.next = 0
        }
    }
}
