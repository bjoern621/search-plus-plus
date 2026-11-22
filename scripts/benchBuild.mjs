// Bundles the bench entry points with the search worker. The bundles run on plain Node without the VS Code host.
import { existsSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"
import * as esbuild from "esbuild"

/**
 * Bundles each entry point to `<outdir>/<name>.mjs` beside `searchWorker.mjs` and returns that folder.
 * The folder lands in the temp folder of the OS and stays after the run.
 */
export async function buildBenchEntries(entryPoints) {
    const outdir = mkdtempSync(join(tmpdir(), "search-plus-plus-bench-"))
    await esbuild.build({
        entryPoints: { ...entryPoints, searchWorker: "src/search/worker/searchWorker.ts" },
        outdir,
        bundle: true,
        platform: "node",
        format: "esm",
        outExtension: { ".js": ".mjs" },
        // The UMD build of jsonc-parser loads its parts through a require that esbuild cannot follow.
        mainFields: ["module", "main"],
        alias: { vscode: "./test/vscodeStub.ts" },
        logLevel: "warning"
    })
    return outdir
}

/** Returns the first ripgrep binary on the PATH. Throws when the PATH holds none. */
export function ripgrepOnPath() {
    const rg = (process.env.PATH ?? "")
        .split(delimiter)
        .map((dir) => join(dir, process.platform === "win32" ? "rg.exe" : "rg"))
        .find(existsSync)
    if (!rg) throw new Error("No ripgrep (rg) on the PATH. Pass --rg <path>.")
    return rg
}
