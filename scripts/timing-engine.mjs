// Times the search runner against ripgrep run as the built-in Search view runs it: `npm run timing:engine -- [--folder <path>] [--query <q>]... [--runs <n>]`.
// The folder defaults to this repository. The run exits with status 1 when the runner takes longer on any query.
import { spawnSync } from "node:child_process"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { buildBenchEntries, ripgrepOnPath } from "./benchBuild.mjs"

const outdir = await buildBenchEntries({ timingEngine: "test/bench/timingEngine.ts" })

const args = process.argv.slice(2)
if (!args.includes("--folder"))
    args.push("--folder", resolve(fileURLToPath(new URL("..", import.meta.url))))
if (!args.includes("--rg")) args.push("--rg", ripgrepOnPath())
args.push("--worker", join(outdir, "searchWorker.mjs"))
const run = spawnSync(process.execPath, [join(outdir, "timingEngine.mjs"), ...args], {
    stdio: "inherit"
})
process.exit(run.status ?? 1)
