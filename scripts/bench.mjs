// Measures the search runner on real folders: `npm run bench -- --folder <path> [--query <q>]... [--all-files] [--no-workers] [--runs <n>]`.
// Each row names the median duration, the matched files and lines and a hash of the matches, so two builds can be compared.
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { buildBenchEntries, ripgrepOnPath } from "./benchBuild.mjs"

const outdir = await buildBenchEntries({ run: "test/bench/run.ts" })

const args = process.argv.slice(2)
if (!args.includes("--no-workers")) args.push("--worker", join(outdir, "searchWorker.mjs"))
if (!args.includes("--rg")) args.push("--rg", ripgrepOnPath())
const run = spawnSync(process.execPath, [join(outdir, "run.mjs"), ...args], { stdio: "inherit" })
process.exit(run.status ?? 1)
