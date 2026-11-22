import { createHash } from "node:crypto"
import { parseArgs } from "node:util"
import type { FileResult } from "../../src/messages"
import { DEFAULT_MATCHING } from "../../src/search/types"
import { SearchWorkerPool } from "../../src/search/worker/pool"
import { benchRoots, type Measurement, measureSearch, median, newBenchRunner } from "./setup"

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

const roots = benchRoots(folders, {
    excludeGlobs: ["**/.git"],
    useIgnoreFiles: !values["all-files"]
})

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

const rows = []
for (const raw of values.query ?? DEFAULT_QUERIES) {
    const samples: Measurement[] = []
    for (let run = 0; run < runs; run++) {
        samples.push(await measureSearch(newBenchRunner(rgPath, workers), raw, matching, roots))
    }
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
