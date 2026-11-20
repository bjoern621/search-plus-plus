// The messages between the search worker pool in the extension host and its worker threads.

import type { FileInfo, LineMatch, Query } from "../types"

/** Starts a search in a worker. The worker keeps the query until `EndSearch` arrives. */
export interface StartSearch {
    type: "start"
    searchId: number
    query: Query
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

/** A file of a chunk in which an engine found a match, with its text and the matches of each engine in the order of `engineIds`. */
export interface FoundFile {
    index: number
    text: string
    lists: LineMatch[][]
}

export interface ChunkDone {
    type: "done"
    chunkId: number
    found: FoundFile[]
    /** A line per engine that threw, for the log. */
    errors: string[]
}

export type FromWorker = ChunkDone
