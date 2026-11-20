// The entry of a worker thread that reads files from disk and runs the built-in engines on them.

import { readFileSync, statSync } from "node:fs"
import { parentPort } from "node:worker_threads"
import { assert, assertNever } from "../assert"
import { FILE_SIZE_LIMIT_BYTES } from "../config"
import { searchTextOf } from "../decode"
import type { LineMatch, Query, SearchEngine, SearchFile } from "../types"
import type { ChunkDone, FoundFile, SearchChunk, ToWorker } from "./protocol"
import { workerEngines } from "./engines"

interface RunningSearch {
    query: Query
    signal: AbortSignal
}

const port = parentPort
if (port === null) throw new Error("searchWorker.js must run in a worker thread")

const engines = new Map(workerEngines().map((engine) => [engine.id, engine]))
const searches = new Map<number, RunningSearch>()

port.on("message", (message: ToWorker) => {
    switch (message.type) {
        case "start":
            searches.set(message.searchId, {
                query: message.query,
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
        const text = readText(file.fsPath)
        if (text === undefined) return
        const lists = file.engineIds.map((id) => {
            const engine = engines.get(id)
            assert(engine !== undefined, "a chunk names only the engines of workerEngines")
            return runEngine(engine, { ...file.info, text }, search, done.errors)
        })
        if (lists.some((list) => list.length > 0))
            done.found.push({ index, text, lists } satisfies FoundFile)
    })
    return done
}

function runEngine(
    engine: SearchEngine,
    file: SearchFile,
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

/** Reads a file as `readSearchText` does. Returns undefined for a binary file, a file over `FILE_SIZE_LIMIT_BYTES` and a file that cannot be read. */
function readText(fsPath: string): string | undefined {
    try {
        if (statSync(fsPath).size > FILE_SIZE_LIMIT_BYTES) return undefined
        return searchTextOf(readFileSync(fsPath))
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
