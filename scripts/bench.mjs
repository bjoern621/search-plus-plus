// Measures the search runner on real folders: `npm run bench -- --folder <path> [--query <q>]... [--all-files] [--no-workers] [--runs <n>]`.
// Each row names the median duration, the matched files and lines and a hash of the matches, so two builds can be compared.
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"
import * as esbuild from "esbuild"

const outdir = mkdtempSync(join(tmpdir(), "search-plus-plus-bench-"))
await esbuild.build({
    entryPoints: { run: "test/bench/run.ts", searchWorker: "src/search/worker/searchWorker.ts" },
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

const args = process.argv.slice(2)
if (!args.includes("--no-workers")) args.push("--worker", join(outdir, "searchWorker.mjs"))
if (!args.includes("--rg")) {
    const rg = (process.env.PATH ?? "")
        .split(delimiter)
        .map((dir) => join(dir, process.platform === "win32" ? "rg.exe" : "rg"))
        .find(existsSync)
    if (!rg) throw new Error("No ripgrep (rg) on the PATH. Pass --rg <path>.")
    args.push("--rg", rg)
}
const run = spawnSync(process.execPath, [join(outdir, "run.mjs"), ...args], { stdio: "inherit" })
process.exit(run.status ?? 1)
