import { RegexEngine } from "../../src/engines/regex"
import { textEngine } from "../../src/engines/text"
import type { FileResult } from "../../src/messages"
import { parseQuery } from "../../src/query"
import { NO_FILE_FIELDS } from "../../src/search/globs"
import { LanguageIndex } from "../../src/search/languages"
import { EngineRegistry } from "../../src/search/registry"
import { SearchRunner } from "../../src/search/runner"
import type { MatchingOptions } from "../../src/search/types"
import type { SearchWorkerPool } from "../../src/search/worker/pool"
import type { SearchRoot } from "../../src/search/workspaceEngine"
import { structuralEngines } from "../../src/structural"

export interface RootOptions {
    excludeGlobs: string[]
    useIgnoreFiles: boolean
}

/** Builds one search root per folder with the walk settings of a VS Code window without user settings. */
export function benchRoots(folders: readonly string[], options: RootOptions): SearchRoot[] {
    return folders.map((fsPath, index) => ({
        index,
        name: folders.length > 1 ? String(index) : "",
        uri: `file://${fsPath}`,
        fsPath,
        walk: {
            excludeGlobs: options.excludeGlobs,
            useIgnoreFiles: options.useIgnoreFiles,
            useParentIgnoreFiles: false,
            useGlobalIgnoreFiles: false,
            followSymlinks: true
        }
    }))
}

/** Builds a runner with every engine that the extension registers. Without `workers`, it searches on the calling thread. */
export function newBenchRunner(
    rgPath: string,
    workers: SearchWorkerPool | undefined
): SearchRunner {
    const registry = new EngineRegistry()
    registry.register(textEngine)
    for (const engine of structuralEngines()) registry.register(engine)
    return new SearchRunner({
        registry,
        workspaceEngines: [new RegexEngine(rgPath, () => {})],
        rgPath,
        languages: () => new LanguageIndex([]),
        log: (message) => console.error(message),
        workers
    })
}

export interface Measurement {
    ms: number
    firstBatchMs: number
    files: FileResult[]
}

/** Runs one search without a result limit and times it until the runner settles. */
export async function measureSearch(
    runner: SearchRunner,
    raw: string,
    matching: MatchingOptions,
    roots: SearchRoot[]
): Promise<Measurement> {
    const files: FileResult[] = []
    let firstBatchMs = -1
    const started = performance.now()
    await runner.run({
        query: parseQuery(raw, matching),
        roots,
        contextLines: 1,
        resultLineLimit: Number.MAX_SAFE_INTEGER,
        fields: NO_FILE_FIELDS,
        signal: new AbortController().signal,
        onBatch: (batch) => {
            if (firstBatchMs < 0) firstBatchMs = performance.now() - started
            files.push(...batch)
        }
    })
    return { ms: performance.now() - started, firstBatchMs, files }
}

export function median(numbers: number[]): number {
    const sorted = [...numbers].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)] ?? 0
}
