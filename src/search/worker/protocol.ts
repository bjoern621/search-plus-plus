// The messages between the search worker pool in the extension host and its worker threads.

import type { FileInfo, LineMatch, Query } from "../types"

/** What a worker gets at its start. */
export interface WorkerData {
    /** The most bytes on disk of the texts that the worker keeps between searches. */
    textCacheBytes: number
}

/** Starts a search in a worker. The worker keeps the query until `EndSearch` arrives. */
export interface StartSearch {
    type: "start"
    searchId: number
    query: Query
    /** The lines of context that a result shows around each matched line. */
    contextLines: number
    /** Holds 1 at index 0 once the search got cancelled. */
    aborted: Int32Array
}

export interface EndSearch {
    type: "end"
    searchId: number
}

/** A file on disk and the engines that accepted it. */
export interface WorkerFile {
    fsPath: string
    info: FileInfo
    engineIds: string[]
}

export interface SearchChunk {
    type: "chunk"
    searchId: number
    chunkId: number
    files: WorkerFile[]
}

export type ToWorker = StartSearch | EndSearch | SearchChunk

/** A file of a chunk in which an engine found a match, with the matches of its engines merged per line. */
export interface FoundFile {
    index: number
    /** The lines that a result of `matches` shows, see `shownLines`. */
    lines: string[]
    matches: LineMatch[]
}

export interface ChunkDone {
    type: "done"
    chunkId: number
    found: FoundFile[]
    /** A line per engine that threw, for the log. */
    errors: string[]
}

export type FromWorker = ChunkDone
