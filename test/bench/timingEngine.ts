import { spawn, spawnSync } from "node:child_process"
import { join } from "node:path"
import { StringDecoder } from "node:string_decoder"
import { parseArgs } from "node:util"
import { DEFAULT_MATCHING } from "../../src/search/types"
import { SearchWorkerPool } from "../../src/search/worker/pool"
import { benchRoots, measureSearch, median, newBenchRunner } from "./setup"

const DEFAULT_QUERIES = ["configuration", "Uri", "Größe"]

// The defaults of `files.exclude` and `search.exclude` in VS Code 1.147.0.
// Search++ leaves out what `files.exclude` hides and searches what `search.exclude` hides.
const FILES_EXCLUDE_DEFAULTS = [
    "**/.git",
    "**/.svn",
    "**/.hg",
    "**/.jj",
    "**/.DS_Store",
    "**/Thumbs.db"
]
const SEARCH_EXCLUDE_DEFAULTS = ["**/node_modules", "**/bower_components", "**/*.code-search"]

const { values } = parseArgs({
    options: {
        folder: { type: "string" },
        query: { type: "string", multiple: true },
        runs: { type: "string", default: "5" },
        rg: { type: "string" },
        worker: { type: "string" }
    }
})

if (!values.folder || !values.rg || !values.worker) {
    throw new Error(
        "Pass --folder <path>, --rg <ripgrep binary> and --worker <bundled search worker>."
    )
}
const folder = values.folder
const rgPath = values.rg
const runs = Number(values.runs)
const workers = new SearchWorkerPool(values.worker, (message) => console.error(message))
const roots = benchRoots([folder], { excludeGlobs: FILES_EXCLUDE_DEFAULTS, useIgnoreFiles: true })

/**
 * The arguments that `getRgArgs` in VS Code 1.147.0 builds for a text query of the Search view under default settings
 * (https://github.com/microsoft/vscode/blob/1.147.0/src/vs/workbench/services/search/node/ripgrepTextSearchEngine.ts).
 * Without a query, they list the files that the search reads.
 */
function vscodeRipgrepArgs(query: string | undefined): string[] {
    const excludes = [...SEARCH_EXCLUDE_DEFAULTS, ...FILES_EXCLUDE_DEFAULTS].flatMap((glob) => [
        "-g",
        `!${glob}`
    ])
    const common = [
        "--hidden",
        "--no-require-git",
        "--ignore-case",
        ...excludes,
        "--no-ignore-parent",
        "--follow"
    ]
    if (query === undefined)
        return [...common, "--no-config", "--no-ignore-global", "--files", "--", "."]
    return [
        ...common,
        "--crlf",
        "--fixed-strings",
        "--no-config",
        "--no-ignore-global",
        "--json",
        "--",
        query,
        "."
    ]
}

interface Count {
    ms: number
    files: number
    lines: number
}

interface RgText {
    text?: string
    bytes?: string
}

interface RgMatch {
    path: RgText
    lines: RgText
    line_number: number
    submatches: { start: number; end: number; match: RgText }[]
}

function textOf(value: RgText): string {
    return value.bytes ? Buffer.from(value.bytes, "base64").toString() : (value.text ?? "")
}

function newlinesIn(text: string): { count: number; lastLineLength: number } {
    const last = text.lastIndexOf("\n")
    return {
        count: text.split("\n").length - 1,
        lastLineLength: last < 0 ? text.length : text.length - last - 1
    }
}

/** Turns the byte offsets of the submatches into line and column ranges, as the `RipgrepParser` of VS Code does. */
function matchRanges(match: RgMatch): number[][] {
    const lineText = Buffer.from(textOf(match.lines))
    let previousEnd = 0
    let previousEndColumn = 0
    let previousEndLine = match.line_number - 1
    return match.submatches.map((submatch) => {
        const between = newlinesIn(lineText.subarray(previousEnd, submatch.start).toString())
        const startColumn =
            between.count > 0 ? between.lastLineLength : between.lastLineLength + previousEndColumn
        const inside = newlinesIn(textOf(submatch.match))
        const startLine = previousEndLine + between.count
        const endLine = startLine + inside.count
        const endColumn =
            inside.count > 0 ? inside.lastLineLength : inside.lastLineLength + startColumn
        previousEnd = submatch.end
        previousEndColumn = endColumn
        previousEndLine = endLine
        return [startLine, startColumn, endLine, endColumn]
    })
}

/**
 * Runs ripgrep as the search process of VS Code runs it: spawned in the folder, its `--json` output decoded and parsed line by line.
 * The time ends once ripgrep closes and the last line got parsed.
 */
async function measureVscodeRipgrep(query: string): Promise<Count> {
    const files = new Set<string>()
    let lines = 0
    const decoder = new StringDecoder()
    let remainder = ""
    let stderr = ""
    const handleText = (text: string): void => {
        const chunk = remainder + text
        const outputLines = chunk.split("\n")
        remainder = outputLines.pop() ?? ""
        for (const outputLine of outputLines) {
            const trimmed = outputLine.trim()
            if (!trimmed) continue
            const message = JSON.parse(trimmed) as { type: string; data: RgMatch }
            if (message.type !== "match") continue
            files.add(join(folder, textOf(message.data.path)))
            matchRanges(message.data)
            lines++
        }
    }

    const started = performance.now()
    const child = spawn(rgPath, vscodeRipgrepArgs(query), { cwd: folder })
    child.stdout.on("data", (data: Buffer) => handleText(decoder.write(data)))
    child.stderr.on("data", (data: Buffer) => (stderr += data.toString()))
    const status = await new Promise<number | null>((resolve, reject) => {
        child.on("error", reject)
        child.on("close", resolve)
    })
    handleText(decoder.end() + "\n")
    const ms = performance.now() - started
    if (status === 2 && lines === 0)
        throw new Error(`ripgrep stopped on "${query}" with status 2: ${stderr.trim()}`)
    return { ms, files: files.size, lines }
}

async function measureSearchPlusPlus(query: string): Promise<Count> {
    const measurement = await measureSearch(
        newBenchRunner(rgPath, workers),
        query,
        DEFAULT_MATCHING,
        roots
    )
    return {
        ms: measurement.ms,
        files: measurement.files.length,
        lines: measurement.files.reduce((sum, file) => sum + file.matchCount, 0)
    }
}

const listed = spawnSync(rgPath, vscodeRipgrepArgs(undefined), { cwd: folder, encoding: "utf8" })
const fileCount = listed.stdout.split("\n").filter(Boolean).length
console.log(
    `${fileCount} files in ${folder}, median of ${runs} runs per query after one warm-up run.`
)

const rows = []
const slower: string[] = []
for (const query of values.query ?? DEFAULT_QUERIES) {
    await measureSearchPlusPlus(query)
    await measureVscodeRipgrep(query)
    const ours: Count[] = []
    const theirs: Count[] = []
    for (let run = 0; run < runs; run++) {
        ours.push(await measureSearchPlusPlus(query))
        theirs.push(await measureVscodeRipgrep(query))
    }
    const oursMs = median(ours.map((count) => count.ms))
    const theirsMs = median(theirs.map((count) => count.ms))
    if (oursMs > theirsMs) slower.push(query)
    rows.push({
        query,
        "Search++ ms": Math.round(oursMs),
        "ripgrep ms": Math.round(theirsMs),
        ratio: `${(oursMs / theirsMs).toFixed(1)}x`,
        "Search++ files": ours.at(-1)!.files,
        "Search++ lines": ours.at(-1)!.lines,
        "ripgrep files": theirs.at(-1)!.files,
        "ripgrep lines": theirs.at(-1)!.lines
    })
}
console.table(rows)

if (slower.length > 0) {
    console.log(
        `Search++ took longer than ripgrep on ${slower.length} of ${rows.length} queries: ${slower.join(", ")}.`
    )
    process.exitCode = 1
} else {
    console.log(`Search++ finished each of ${rows.length} queries before ripgrep.`)
}
