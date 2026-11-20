import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import * as path from "node:path"
import * as esbuild from "esbuild"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { PoolSearch, SearchWorkerPool } from "../../src/search/worker/pool"
import { Uri, workspace } from "../vscodeStub"
import { folderWith, matchedLines, rootAt, runSearch } from "./runnerSetup"

const FILES = {
    "a.txt": "the configuraton\nGroesse und Größe\ngetUserConfig()\n",
    "b.json": '{ "compilerOptions": { "strict": true }, "version": "1.0" }\n',
    "c.yaml": "server:\n  version: 2\n  strict: false\n",
    "d.bin": "configuration\u0000\n",
    "e.ts": "const size = config.compilerOptions.strict\n"
}

const QUERIES = ["configuration", "Größe", "get*Config", "compilerOptions.strict", "**.version"]

let workerScript: string
let pools: SearchWorkerPool[] = []

beforeAll(async () => {
    const outdir = await mkdtemp(path.join(tmpdir(), "search-plus-plus-worker-"))
    await esbuild.build({
        entryPoints: { searchWorker: "src/search/worker/searchWorker.ts" },
        outdir,
        bundle: true,
        platform: "node",
        format: "cjs",
        mainFields: ["module", "main"],
        logLevel: "warning"
    })
    workerScript = path.join(outdir, "searchWorker.js")
})

afterEach(() => {
    for (const pool of pools) pool.dispose()
    pools = []
    vi.restoreAllMocks()
})

function poolOf(script: string, log: string[] = []): SearchWorkerPool {
    const pool = new SearchWorkerPool(script, (message) => log.push(message), 2)
    pools.push(pool)
    return pool
}

describe("SearchWorkerPool", () => {
    it("finds in worker threads what the extension host finds", async () => {
        const dir = await folderWith(FILES)
        const added = vi.spyOn(PoolSearch.prototype, "add")
        const workers = poolOf(workerScript)
        for (const query of QUERIES) {
            const inHost = await runSearch(query, [rootAt(0, dir)], { structural: true })
            const inWorkers = await runSearch(query, [rootAt(0, dir)], {
                structural: true,
                workers
            })
            expect(matchedLines(inHost.files), query).not.toEqual([])
            expect(matchedLines(inWorkers.files), query).toEqual(matchedLines(inHost.files))
            expect(inWorkers.log, query).toEqual([])
        }
        expect(added).toHaveBeenCalled()
    })

    it("searches in the extension host the files of a worker that failed", async () => {
        const dir = await folderWith(FILES)
        const failing = path.join(await mkdtemp(path.join(tmpdir(), "search-plus-plus-")), "w.js")
        await writeFile(failing, 'throw new Error("no worker today")\n')
        const log: string[] = []
        const workers = poolOf(failing, log)
        const inHost = await runSearch("configuration", [rootAt(0, dir)], { structural: true })
        const inWorkers = await runSearch("configuration", [rootAt(0, dir)], {
            structural: true,
            workers
        })
        expect(matchedLines(inWorkers.files)).toEqual(matchedLines(inHost.files))
        expect(log.join("\n")).toContain("no worker today")
        const again = await runSearch("Größe", [rootAt(0, dir)], { structural: true, workers })
        expect(matchedLines(again.files)).toEqual(["a.txt:2: Groesse und Größe"])
    })

    it("searches the editor text of a file with unsaved changes in the extension host", async () => {
        const dir = await folderWith({ "a.txt": "needle\n", "b.txt": "nothing\n" })
        workspace.textDocuments = [
            { uri: Uri.file(path.join(dir, "b.txt")), isDirty: true, getText: () => "needle\n" }
        ]
        try {
            const result = await runSearch("needle", [rootAt(0, dir)], {
                workers: poolOf(workerScript)
            })
            expect(matchedLines(result.files)).toEqual(["a.txt:1: needle", "b.txt:1: needle"])
        } finally {
            workspace.textDocuments = []
        }
    })

    it("leaves a file that an engine of another extension accepts to the extension host", async () => {
        const dir = await folderWith({ "a.txt": "needle\n", "b.md": "needle x\n" })
        const result = await runSearch("needle", [rootAt(0, dir)], {
            workers: poolOf(workerScript),
            plugins: (api) =>
                api.registerEngine({
                    id: "markdown",
                    accepts: (file) => file.relativePath.endsWith(".md"),
                    search: () => [{ line: 0, ranges: [{ start: 7, end: 8 }], reasons: [] }]
                })
        })
        expect(result.files.find((file) => file.name === "b.md")?.blocks[0]?.[0]?.ranges).toEqual([
            { start: 0, end: 6 },
            { start: 7, end: 8 }
        ])
        expect(matchedLines(result.files)).toEqual(["a.txt:1: needle", "b.md:1: needle x"])
    })

    it("stops at the result limit of the request", async () => {
        const dir = await folderWith(
            Object.fromEntries(
                Array.from({ length: 300 }, (_, file) => [`f${file}.txt`, "needle\n"])
            )
        )
        const result = await runSearch("needle", [rootAt(0, dir)], {
            resultLineLimit: 7,
            workers: poolOf(workerScript)
        })
        expect(result.outcome).toEqual({ status: "capped", limit: 7 })
        expect(result.files.reduce((sum, file) => sum + file.matchCount, 0)).toBe(7)
    })
})
