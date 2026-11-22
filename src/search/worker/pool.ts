import { availableParallelism } from "node:os"
import { Worker } from "node:worker_threads"
import { assert } from "../assert"
import {
    SEARCH_TEXT_CACHE_MAX_BYTES,
    SEARCH_WORKER_CHUNK_FILES,
    SEARCH_WORKER_CHUNKS_IN_FLIGHT,
    SEARCH_WORKER_COUNT_MAX,
    SEARCH_WORKER_IDLE_DURATION_MS
} from "../config"
import type { LineMatch, Query } from "../types"
import { workerEngines } from "./engines"
import type { FromWorker, ToWorker, WorkerData, WorkerFile } from "./protocol"

export type { WorkerFile } from "./protocol"

/** Receives the merged matches of a file and the lines that its result shows, see `FoundFile`. */
export type OnFound = (lines: string[], matches: LineMatch[]) => void

/** A file handed to the pool and what to do with its outcome. */
interface Job {
    file: WorkerFile
    /** Runs once an engine found a match. */
    onFound: OnFound
    /** Runs once a worker failed before it searched the file. The caller then searches the file in its own thread. */
    onLost: () => void
}

interface PoolWorker {
    worker: Worker
    /** Maps a chunk id to the search and the jobs of a chunk that the worker holds. */
    chunks: Map<number, { search: PoolSearch; jobs: Job[] }>
    /** The ids of the searches that the worker got a `start` message for. */
    started: Set<number>
}

/**
 * Searches files on disk with the built-in engines in worker threads.
 * Each file goes to the same worker in every search, since a worker keeps the texts that it read, see `TextCache`.
 * The workers start with the first search and quit after `SEARCH_WORKER_IDLE_DURATION_MS` without one.
 * Once a worker fails, the pool hands back every file that it holds and takes no further search.
 */
export class SearchWorkerPool {
    /** The ids of the engines that a worker runs. A file goes to the pool only when every engine that accepts it has one of these ids. */
    readonly engineIds: ReadonlySet<string> = new Set(workerEngines().map((engine) => engine.id))
    private workers: PoolWorker[] = []
    /** The searches that hold files, in the order that they started. */
    private readonly searches = new Set<PoolSearch>()
    private broken = false
    private idleTimer: NodeJS.Timeout | undefined
    private nextSearchId = 1
    private nextChunkId = 1

    constructor(
        private readonly scriptPath: string,
        private readonly log: (message: string) => void,
        private readonly workerCount = defaultWorkerCount()
    ) {
        assert(workerCount >= 1, "a search worker pool needs at least one worker")
    }

    /** Starts a search with `query`. Returns undefined once a worker failed. The caller then searches in its own thread. */
    start(query: Query, contextLines: number, signal: AbortSignal): PoolSearch | undefined {
        if (this.broken) return undefined
        clearTimeout(this.idleTimer)
        if (this.workers.length === 0) {
            try {
                this.spawnWorkers()
            } catch (error) {
                this.fail(`No search worker could start: ${String(error)}`)
                return undefined
            }
        }
        const search = new PoolSearch(
            this,
            this.nextSearchId++,
            query,
            contextLines,
            this.workers.length,
            signal
        )
        this.searches.add(search)
        return search
    }

    /** Stops every worker. A search still running gets its files handed back. */
    dispose(): void {
        this.fail(undefined)
    }

    /** Sends the ready chunks of the searches to the workers with room, oldest search first. */
    pump(): void {
        for (const search of this.searches) {
            this.workers.forEach((worker, index) => {
                while (worker.chunks.size < SEARCH_WORKER_CHUNKS_IN_FLIGHT) {
                    const jobs = search.takeChunk(index, worker.chunks.size === 0)
                    if (jobs === undefined) return
                    this.send(worker, search, jobs)
                }
            })
        }
    }

    /** Ends a search whose files all came back. */
    finish(search: PoolSearch): void {
        if (!this.searches.delete(search)) return
        for (const worker of this.workers) {
            if (worker.started.delete(search.id)) post(worker, { type: "end", searchId: search.id })
        }
        if (this.searches.size === 0) {
            this.idleTimer = setTimeout(() => this.stopWorkers(), SEARCH_WORKER_IDLE_DURATION_MS)
            this.idleTimer.unref()
        }
    }

    /** True if the worker at `workerIndex` holds no chunk. */
    isIdle(workerIndex: number): boolean {
        return this.workers[workerIndex]?.chunks.size === 0
    }

    isBroken(): boolean {
        return this.broken
    }

    private spawnWorkers(): void {
        for (let index = 0; index < this.workerCount; index++) {
            const worker: PoolWorker = {
                worker: new Worker(this.scriptPath, {
                    workerData: {
                        textCacheBytes: Math.floor(SEARCH_TEXT_CACHE_MAX_BYTES / this.workerCount)
                    } satisfies WorkerData
                }),
                chunks: new Map(),
                started: new Set()
            }
            worker.worker.unref()
            worker.worker.on("message", (message: FromWorker) => this.receive(worker, message))
            worker.worker.on("error", (error) =>
                this.fail(`A search worker failed: ${String(error)}`)
            )
            worker.worker.on("exit", (code) => {
                if (this.workers.includes(worker))
                    this.fail(`A search worker quit with exit code ${code}`)
            })
            this.workers.push(worker)
        }
    }

    private send(worker: PoolWorker, search: PoolSearch, jobs: Job[]): void {
        if (!worker.started.has(search.id)) {
            worker.started.add(search.id)
            post(worker, {
                type: "start",
                searchId: search.id,
                query: search.query,
                contextLines: search.contextLines,
                aborted: search.aborted
            })
        }
        const chunkId = this.nextChunkId++
        if (worker.chunks.size === 0) worker.worker.ref()
        worker.chunks.set(chunkId, { search, jobs })
        post(worker, {
            type: "chunk",
            searchId: search.id,
            chunkId,
            files: jobs.map((job) => job.file)
        })
    }

    private receive(worker: PoolWorker, message: FromWorker): void {
        // A stopped worker may still deliver a message. Its files went back to the caller.
        if (!this.workers.includes(worker)) return
        const chunk = worker.chunks.get(message.chunkId)
        assert(chunk !== undefined, "a worker answers each chunk once")
        worker.chunks.delete(message.chunkId)
        if (worker.chunks.size === 0) worker.worker.unref()
        for (const error of message.errors) this.log(error)
        for (const found of message.found) {
            const job = chunk.jobs[found.index]
            assert(job !== undefined, "a found file names an index of its chunk")
            job.onFound(found.lines, found.matches)
        }
        chunk.search.chunkReturned()
        this.pump()
    }

    /** Stops the workers and hands back every file that they hold or that waits for them. `reason` goes to the log and keeps the pool from taking another search. */
    private fail(reason: string | undefined): void {
        if (reason !== undefined) {
            if (this.broken) return
            this.broken = true
            this.log(`${reason}. The search goes on in the extension host.`)
        }
        const workers = this.workers
        this.workers = []
        clearTimeout(this.idleTimer)
        for (const worker of workers) {
            void worker.worker.terminate()
            for (const { search, jobs } of worker.chunks.values()) {
                for (const job of jobs) job.onLost()
                search.chunkReturned()
            }
        }
        for (const search of [...this.searches]) search.handBack()
    }

    private stopWorkers(): void {
        const workers = this.workers
        this.workers = []
        for (const worker of workers) void worker.worker.terminate()
    }
}

/** The files of one search on their way through the pool. */
export class PoolSearch {
    /** Holds 1 at index 0 once the search got cancelled. The workers read it between files and inside engines. */
    readonly aborted = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT))
    /** The files that wait for each worker, by the index of the worker. */
    private readonly queues: JobQueue[]
    private chunksOut = 0
    private closed = false
    private onDrained: (() => void) | undefined

    constructor(
        private readonly pool: SearchWorkerPool,
        readonly id: number,
        readonly query: Query,
        readonly contextLines: number,
        workerCount: number,
        private readonly signal: AbortSignal
    ) {
        this.queues = Array.from({ length: workerCount }, () => new JobQueue())
        signal.addEventListener("abort", () => {
            Atomics.store(this.aborted, 0, 1)
            for (const queue of this.queues) queue.clear()
            this.settle()
        })
    }

    /**
     * Queues a file for the worker that `workerIndexOf` picks for its path.
     * `onFound` runs once an engine found a match. `onLost` runs when a worker failed first.
     */
    add(file: WorkerFile, onFound: OnFound, onLost: () => void): void {
        assert(!this.closed, "a search takes no file once drained() got called")
        if (this.signal.aborted) return
        if (this.pool.isBroken()) {
            onLost()
            return
        }
        const workerIndex = workerIndexOf(file.fsPath, this.queues.length)
        const queue = this.queues[workerIndex]!
        queue.push({ file, onFound, onLost })
        if (queue.size() >= SEARCH_WORKER_CHUNK_FILES || this.pool.isIdle(workerIndex))
            this.pool.pump()
    }

    /** Resolves once every queued file came back. The search then takes no further file. */
    drained(): Promise<void> {
        this.closed = true
        const done = new Promise<void>((resolve) => (this.onDrained = resolve))
        this.pool.pump()
        this.settle()
        return done
    }

    /**
     * Returns the next chunk of files for the worker at `workerIndex`, or undefined when none is ready.
     * A full chunk is ready at once. A shorter one is ready once the search got closed or the worker is `idle`.
     * An idle worker would otherwise wait for files that the listing has yet to find.
     */
    takeChunk(workerIndex: number, idle: boolean): Job[] | undefined {
        const queue = this.queues[workerIndex]
        assert(queue !== undefined, "a search keeps a queue per worker of the pool")
        if (queue.size() === 0) return undefined
        if (!this.closed && !idle && queue.size() < SEARCH_WORKER_CHUNK_FILES) return undefined
        this.chunksOut++
        return queue.take(SEARCH_WORKER_CHUNK_FILES)
    }

    chunkReturned(): void {
        assert(this.chunksOut > 0, "a chunk comes back once per chunk sent")
        this.chunksOut--
        this.settle()
    }

    /** Hands every waiting file back to the caller, since the pool lost its workers. */
    handBack(): void {
        const lost = this.queues.flatMap((queue) => queue.take(queue.size()))
        for (const job of lost) job.onLost()
        this.settle()
    }

    private waiting(): number {
        return this.queues.reduce((sum, queue) => sum + queue.size(), 0)
    }

    private settle(): void {
        if (!this.closed || this.waiting() > 0 || this.chunksOut > 0) return
        this.pool.finish(this)
        this.onDrained?.()
        this.onDrained = undefined
    }
}

/** The files that wait for one worker, oldest first. */
class JobQueue {
    private jobs: Job[] = []
    /** The index in `jobs` of the file that goes out next. A splice per chunk would copy the rest of a long queue. */
    private next = 0

    push(job: Job): void {
        this.jobs.push(job)
    }

    size(): number {
        return this.jobs.length - this.next
    }

    take(count: number): Job[] {
        const taken = this.jobs.slice(this.next, this.next + count)
        this.next += taken.length
        if (this.next === this.jobs.length) this.clear()
        return taken
    }

    clear(): void {
        this.jobs = []
        this.next = 0
    }
}

/** Picks a worker by a hash (FNV-1a) of the path, so a file reaches the worker that keeps its text. */
function workerIndexOf(fsPath: string, workerCount: number): number {
    let hash = 0x811c9dc5
    for (let index = 0; index < fsPath.length; index++)
        hash = Math.imul(hash ^ fsPath.charCodeAt(index), 0x01000193)
    return (hash >>> 0) % workerCount
}

function defaultWorkerCount(): number {
    return Math.max(1, Math.min(SEARCH_WORKER_COUNT_MAX, availableParallelism() - 1))
}

function post(worker: PoolWorker, message: ToWorker): void {
    worker.worker.postMessage(message)
}
