// The entry of a worker thread that reads files from disk and runs the built-in engines on them.

import { readFileSync, statSync } from "node:fs"
import { parentPort, workerData } from "node:worker_threads"
import { assert, assertNever } from "../assert"
import { FILE_SIZE_LIMIT_BYTES } from "../config"
import { searchTextOf } from "../decode"
import { fileMatches, shownLines, splitLines } from "../results"
import type { LineMatch, PreparedFile, Query, SearchEngine } from "../types"
import type { ChunkDone, SearchChunk, ToWorker, WorkerData } from "./protocol"
import { workerEngines } from "./engines"
import { type CachedFile, cachedFile, TextCache } from "./textCache"

interface RunningSearch {
    query: Query
    contextLines: number
    signal: AbortSignal
}

const port = parentPort
if (port === null) throw new Error("searchWorker.js must run in a worker thread")

const texts = new TextCache((workerData as WorkerData).textCacheBytes)

const engines = new Map(workerEngines().map((engine) => [engine.id, engine]))
const searches = new Map<number, RunningSearch>()

port.on("message", (message: ToWorker) => {
    switch (message.type) {
        case "start":
            texts.startSearch()
            searches.set(message.searchId, {
                query: message.query,
                contextLines: message.contextLines,
                signal: flagSignal(message.aborted)
            })
            return
        case "end":
            searches.delete(message.searchId)
            return
        case "chunk":
            port.postMessage(searchChunk(message))
            return
        default:
            assertNever(message)
    }
})

function searchChunk(chunk: SearchChunk): ChunkDone {
    const done: ChunkDone = { type: "done", chunkId: chunk.chunkId, found: [], errors: [] }
    const search = searches.get(chunk.searchId)
    if (search === undefined) return done
    chunk.files.forEach((file, index) => {
        if (search.signal.aborted) return
        const cached = readFile(file.fsPath)
        if (cached?.text === undefined || cached.folds === undefined) return
        const text = cached.text
        let lines: string[] | undefined
        const prepared: PreparedFile = {
            ...file.info,
            text,
            folds: cached.folds,
            lines: () => (lines ??= splitLines(text)),
            memo: <T>(key: string, build: () => T): T => {
                if (cached.memos.has(key)) return cached.memos.get(key) as T
                const value = build()
                cached.memos.set(key, value)
                return value
            }
        }
        const lists = file.engineIds.map((id) => {
            const engine = engines.get(id)
            assert(engine !== undefined, "a chunk names only the engines of workerEngines")
            return runEngine(engine, prepared, search, done.errors)
        })
        if (lists.every((list) => list.length === 0)) return
        const { matches } = fileMatches(prepared.lines(), lists)
        if (matches.length === 0) return
        done.found.push({
            index,
            lines: shownLines(prepared.lines(), matches, search.contextLines),
            matches
        })
    })
    return done
}

function runEngine(
    engine: SearchEngine,
    file: PreparedFile,
    search: RunningSearch,
    errors: string[]
): LineMatch[] {
    try {
        const found = engine.search(file, search.query, search.signal)
        if (found instanceof Promise)
            throw new Error("a worker engine must return its matches without a promise")
        return found
    } catch (error) {
        if (!search.signal.aborted)
            errors.push(
                `Search engine ${engine.id} could not search ${file.relativePath}: ${String(error)}`
            )
        return []
    }
}

/**
 * Reads a file as `readSearchText` does, from `texts` while it keeps its size and modification time.
 * Returns undefined for a file over `FILE_SIZE_LIMIT_BYTES` and a file that cannot be read.
 */
function readFile(fsPath: string): CachedFile | undefined {
    try {
        const stat = statSync(fsPath)
        if (stat.size > FILE_SIZE_LIMIT_BYTES) return undefined
        const known = texts.get(fsPath, stat.mtimeMs, stat.size)
        if (known !== undefined) return known
        const file = cachedFile(stat.mtimeMs, stat.size, searchTextOf(readFileSync(fsPath)))
        texts.set(fsPath, file)
        return file
    } catch {
        return undefined
    }
}

/**
 * Turns the shared flag of a search into the signal that the engines read.
 * The built-in engines read `aborted` alone.
 * A message could not reach a worker that runs an engine.
 */
function flagSignal(aborted: Int32Array): AbortSignal {
    return {
        get aborted() {
            return Atomics.load(aborted, 0) === 1
        }
    } as AbortSignal
}
