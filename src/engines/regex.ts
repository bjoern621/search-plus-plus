import { hintFor, type Hint } from "../query"
import { runRipgrep } from "../search/ripgrep"
import type { LineMatch, Query } from "../search/types"
import { ripgrepWalkArgs } from "../search/walk"
import type { SearchRoot, WorkspaceSearchEngine } from "../search/workspaceEngine"
import { parseRipgrepEvent, regexErrorMessage } from "./ripgrepJson"
import { TextBatch } from "./textBatch"

/**
 * Runs a regex query through ripgrep, which compiles it with the syntax of the Rust regex crate.
 * Without `rgPath`, every regex query stops at a hint.
 * Folders on a file system other than the disk stay unsearched.
 * A folder that ripgrep cannot start in, such as a deleted one, adds a log line. The search goes on in the next folder.
 */
export class RegexEngine implements WorkspaceSearchEngine {
    readonly id = "regex"

    constructor(
        private readonly rgPath: string | undefined,
        private readonly log: (message: string) => void
    ) {}

    acceptsQuery(query: Query): boolean {
        return query.kind === "regex"
    }

    async check(query: Query, signal: AbortSignal): Promise<Hint | undefined> {
        if (query.kind !== "regex") return undefined
        if (!this.rgPath) {
            return {
                text: "This VS Code build has no ripgrep, so regex search cannot run. Remove the slashes to search as text.",
                tone: "info",
                suggestedQuery: query.source
            }
        }
        // Without a path, ripgrep searches its empty input: it compiles the regex and finds nothing.
        const exit = await runRipgrep(this.rgPath, ["--no-config", "--regexp", query.source], {
            signal
        })
        if (exit.code !== 2) return undefined
        return hintFor(query, regexErrorMessage(exit.stderr))
    }

    async search(
        roots: readonly SearchRoot[],
        query: Query,
        signal: AbortSignal,
        onFile: (root: SearchRoot, relativePath: string, matches: LineMatch[]) => void
    ): Promise<void> {
        if (query.kind !== "regex" || !this.rgPath) return
        for (const root of roots) {
            if (signal.aborted) return
            if (root.fsPath === undefined) continue
            try {
                await this.searchRoot(this.rgPath, root, root.fsPath, query.source, signal, onFile)
            } catch (error) {
                if (!signal.aborted)
                    this.log(`ripgrep could not search ${root.fsPath}: ${String(error)}`)
            }
        }
    }

    async searchTexts(
        texts: readonly string[],
        query: Query,
        signal: AbortSignal
    ): Promise<LineMatch[][]> {
        const matches: LineMatch[][] = texts.map(() => [])
        if (query.kind !== "regex" || !this.rgPath || texts.length === 0) return matches
        const batch = new TextBatch(texts)
        const exit = await runRipgrep(
            this.rgPath,
            ["--json", "--no-config", "--case-sensitive", "--regexp", query.source, "-"],
            {
                stdin: batch.input,
                signal,
                onLine: (line) => {
                    const event = parseRipgrepEvent(line)
                    if (event.kind !== "match") return
                    const place = batch.locate(event.line)
                    matches[place.text]?.push({
                        line: place.line,
                        ranges: event.ranges,
                        reasons: []
                    })
                }
            }
        )
        if (exit.code === 2)
            this.log(`ripgrep reported errors on texts from the editor: ${exit.stderr.trim()}`)
        return matches
    }

    private async searchRoot(
        rgPath: string,
        root: SearchRoot,
        cwd: string,
        source: string,
        signal: AbortSignal,
        onFile: (root: SearchRoot, relativePath: string, matches: LineMatch[]) => void
    ): Promise<void> {
        const args = [
            "--json",
            "--case-sensitive",
            ...ripgrepWalkArgs(root.walk),
            "--regexp",
            source,
            "--",
            "."
        ]
        let matches: LineMatch[] = []
        const exit = await runRipgrep(rgPath, args, {
            cwd,
            signal,
            onLine: (line) => {
                const event = parseRipgrepEvent(line)
                switch (event.kind) {
                    case "match":
                        matches.push({ line: event.line, ranges: event.ranges, reasons: [] })
                        return
                    case "end":
                        if (matches.length > 0) onFile(root, stripDotSlash(event.path), matches)
                        matches = []
                        return
                    case "other":
                        return
                }
            }
        })
        // Code 2 also covers files that ripgrep could not read. The matches it found still count.
        if (exit.code === 2) this.log(`ripgrep reported errors in ${cwd}: ${exit.stderr.trim()}`)
    }
}

/** ripgrep prints paths below `.` as `./a/b`, with the platform separator. */
function stripDotSlash(path: string): string {
    const slashed = process.platform === "win32" ? path.replace(/\\/g, "/") : path
    return slashed.replace(/^\.\//, "")
}
