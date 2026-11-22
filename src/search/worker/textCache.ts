import { FileFolds } from "../../matching"
import { assert } from "../assert"

/** A file that a worker read, as its size and modification time on disk named it then. */
export interface CachedFile {
    mtimeMs: number
    size: number
    /** Undefined for a binary file, which no search reads again until it changes. */
    text: string | undefined
    /** The folds of `text`, kept with it since a fuzzy search derives them anew per file otherwise. */
    folds: FileFolds | undefined
}

interface Entry {
    file: CachedFile
    /** The search that read the file last, see `startSearch`. */
    search: number
}

/**
 * Keeps the files that a worker read, up to `maxBytes` on disk.
 * A file whose size or modification time changed reads again.
 * A full cache makes room by dropping the files that no search since the last `startSearch` read, the least recently read first.
 * It keeps the files of the running search, since a search that reads more than fits would otherwise drop each file before the next search reads it again.
 * The texts and their folds take a few times their size on disk in memory.
 */
export class TextCache {
    /** In the order of the last read, oldest first. */
    private readonly entries = new Map<string, Entry>()
    private bytes = 0
    private search = 0

    constructor(private readonly maxBytes: number) {
        assert(maxBytes >= 0, "a text cache must not hold less than 0 bytes")
    }

    /** Marks the files read from now on as the files of a new search. */
    startSearch(): void {
        this.search++
    }

    /** Returns the file at `fsPath` if it kept its size and modification time. Drops a file that changed. */
    get(fsPath: string, mtimeMs: number, size: number): CachedFile | undefined {
        const entry = this.entries.get(fsPath)
        if (entry === undefined) return undefined
        this.entries.delete(fsPath)
        if (entry.file.mtimeMs !== mtimeMs || entry.file.size !== size) {
            this.bytes -= entry.file.size
            return undefined
        }
        entry.search = this.search
        this.entries.set(fsPath, entry)
        return entry.file
    }

    /** Keeps `file` if dropping the files of earlier searches makes room for it. */
    set(fsPath: string, file: CachedFile): void {
        const known = this.entries.get(fsPath)
        if (known !== undefined) {
            this.entries.delete(fsPath)
            this.bytes -= known.file.size
        }
        for (const [oldPath, old] of this.entries) {
            if (this.bytes + file.size <= this.maxBytes || old.search === this.search) break
            this.entries.delete(oldPath)
            this.bytes -= old.file.size
        }
        if (this.bytes + file.size > this.maxBytes) return
        this.entries.set(fsPath, { file, search: this.search })
        this.bytes += file.size
    }
}

/** Builds the cache entry of a file read from disk. */
export function cachedFile(mtimeMs: number, size: number, text: string | undefined): CachedFile {
    return { mtimeMs, size, text, folds: text === undefined ? undefined : new FileFolds(text) }
}
