import { createHash } from "node:crypto"
import { parseArgs } from "node:util"
import { RegexEngine } from "../../src/engines/regex"
import { textEngine } from "../../src/engines/text"
import type { FileResult } from "../../src/messages"
import { parseQuery } from "../../src/query"
import { NO_FILE_FIELDS } from "../../src/search/globs"
import { LanguageIndex } from "../../src/search/languages"
import { EngineRegistry } from "../../src/search/registry"
import { SearchRunner } from "../../src/search/runner"
import { DEFAULT_MATCHING } from "../../src/search/types"
import { SearchWorkerPool } from "../../src/search/worker/pool"
import type { SearchRoot } from "../../src/search/workspaceEngine"
import { structuralEngines } from "../../src/structural"

const DEFAULT_QUERIES = [
    "configuration",
    "Uri",
    '"Uri"',
    "get*Config",
    "Größe",
    "compilerOptions.strict",
    "**.version",
    "/Uri\\.parse/"
]

const { values } = parseArgs({
    options: {
        folder: { type: "string", multiple: true },
        query: { type: "string", multiple: true },
        runs: { type: "string", default: "3" },
        "all-files": { type: "boolean", default: false },
        "no-fuzzy": { type: "boolean", default: false },
        rg: { type: "string" },
        worker: { type: "string" },
        "no-workers": { type: "boolean", default: false },
        json: { type: "boolean", default: false }
    }
})

const folders = values.folder ?? []
if (folders.length === 0 || !values.rg) {
    throw new Error("Pass --rg <ripgrep binary> and at least one --folder <path>.")
}
const rgPath = values.rg
const runs = Number(values.runs)
const matching = { ...DEFAULT_MATCHING, fuzzy: !values["no-fuzzy"] }
const workers =
    values.worker === undefined
        ? undefined
        : new SearchWorkerPool(values.worker, (message) => console.error(message))

const roots: SearchRoot[] = folders.map((fsPath, index) => ({
    index,
    name: folders.length > 1 ? String(index) : "",
    uri: `file://${fsPath}`,
    fsPath,
    walk: {
        excludeGlobs: ["**/.git"],
        useIgnoreFiles: !values["all-files"],
        useParentIgnoreFiles: false,
        useGlobalIgnoreFiles: false,
        followSymlinks: true
    }
}))

function newRunner(): SearchRunner {
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

interface Measurement {
    ms: number
    firstBatchMs: number
    files: FileResult[]
}

async function measure(runner: SearchRunner, raw: string): Promise<Measurement> {
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

/** Hashes the matched lines with their ranges, reasons and key paths, so two builds can be compared for equal results. */
function resultHash(files: readonly FileResult[]): string {
    const entries = files.flatMap((file) =>
        file.blocks
            .flat()
            .filter((line) => line.match)
            .map((line) =>
                JSON.stringify([
                    file.uri,
                    line.line,
                    line.ranges,
                    line.reasons ?? [],
                    line.keyPath ?? []
                ])
            )
    )
    return createHash("sha256").update(entries.sort().join("\n")).digest("hex").slice(0, 12)
}

function median(numbers: number[]): number {
    const sorted = [...numbers].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)] ?? 0
}

const rows = []
for (const raw of values.query ?? DEFAULT_QUERIES) {
    const samples: Measurement[] = []
    for (let run = 0; run < runs; run++) samples.push(await measure(newRunner(), raw))
    const last = samples.at(-1)!
    rows.push({
        query: raw,
        ms: Math.round(median(samples.map((sample) => sample.ms))),
        firstBatchMs: Math.round(median(samples.map((sample) => sample.firstBatchMs))),
        files: last.files.length,
        lines: last.files.reduce((sum, file) => sum + file.matchCount, 0),
        hash: resultHash(last.files)
    })
}

if (values.json) {
    console.log(JSON.stringify(rows))
} else {
    console.table(rows)
}
