import { existsSync } from "node:fs"
import { mkdtemp, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { RegexEngine } from "../../src/engines/regex"
import { textEngine } from "../../src/engines/text"
import type { FileResult } from "../../src/messages"
import { parseQuery } from "../../src/query"
import { NO_FILE_FIELDS } from "../../src/search/globs"
import { LanguageIndex } from "../../src/search/languages"
import { EngineRegistry } from "../../src/search/registry"
import { SearchRunner, type SearchOutcome } from "../../src/search/runner"
import type { SearchRoot } from "../../src/search/workspaceEngine"

/** The ripgrep binary on the PATH. The runner tests need one, as VS Code ships one to the extension. */
export function ripgrepOnPath(): string {
    for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
        const candidate = path.join(dir, process.platform === "win32" ? "rg.exe" : "rg")
        if (existsSync(candidate)) return candidate
    }
    throw new Error("No ripgrep (rg) on the PATH. Install ripgrep to run the runner tests.")
}

/** Creates a folder that holds `files`, which map a relative path to its text. */
export async function folderWith(files: Record<string, string>): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), "search-plus-plus-test-"))
    for (const [relativePath, text] of Object.entries(files)) {
        await mkdir(path.dirname(path.join(dir, relativePath)), { recursive: true })
        await writeFile(path.join(dir, relativePath), text)
    }
    return dir
}

export function rootAt(index: number, fsPath: string): SearchRoot {
    return {
        index,
        name: "",
        uri: `file://${fsPath}`,
        fsPath,
        walk: {
            excludeGlobs: [],
            useIgnoreFiles: true,
            useParentIgnoreFiles: false,
            useGlobalIgnoreFiles: false,
            followSymlinks: true
        }
    }
}

export interface RunResult {
    outcome: SearchOutcome
    files: FileResult[]
    log: string[]
}

/** Runs `raw` through a runner with the text and regex engines, as the extension builds it. */
export async function runSearch(
    raw: string,
    roots: SearchRoot[],
    options: { rgPath?: string; resultLineLimit?: number } = {}
): Promise<RunResult> {
    const rgPath = "rgPath" in options ? options.rgPath : ripgrepOnPath()
    const log: string[] = []
    const registry = new EngineRegistry()
    registry.register(textEngine)
    const runner = new SearchRunner({
        registry,
        workspaceEngines: [new RegexEngine(rgPath, (message) => log.push(message))],
        rgPath,
        languages: () => new LanguageIndex([]),
        log: (message) => log.push(message)
    })
    const files: FileResult[] = []
    const outcome = await runner.run({
        query: parseQuery(raw),
        roots,
        contextLines: 0,
        resultLineLimit: options.resultLineLimit,
        fields: NO_FILE_FIELDS,
        signal: new AbortController().signal,
        onBatch: (batch) => files.push(...batch)
    })
    return { outcome, files, log }
}

/** Writes each matched line of `files` as `<path>:<1-based line>: <text>`, sorted. */
export function matchedLines(files: readonly FileResult[]): string[] {
    return files
        .flatMap((file) =>
            file.blocks
                .flat()
                .filter((line) => line.match)
                .map(
                    (line) =>
                        `${file.folder === "" ? "" : `${file.folder}/`}${file.name}:${line.line + 1}: ${line.text}`
                )
        )
        .sort()
}
