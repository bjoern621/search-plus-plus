import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import * as path from "node:path"
import * as readline from "node:readline"

export interface RipgrepExit {
    /** 0: found, 1: found nothing, 2: an error. Null when the signal stopped the process. */
    code: number | null
    stderr: string
}

/**
 * Finds the ripgrep binary that ships with VS Code under `appRoot` (`vscode.env.appRoot`).
 * Returns undefined when this VS Code build ships none.
 */
export function findRipgrep(appRoot: string): string | undefined {
    return ripgrepCandidates(appRoot).find((candidate) => existsSync(candidate))
}

/** Binaries inside `node_modules.asar` cannot run, so the unpacked copy comes first. */
function ripgrepCandidates(appRoot: string): string[] {
    const binary = process.platform === "win32" ? "rg.exe" : "rg"
    const packages = [
        path.join(
            "@vscode",
            "ripgrep-universal",
            "bin",
            `${process.platform}-${process.arch}`,
            binary
        ),
        path.join("@vscode", "ripgrep", "bin", binary)
    ]
    return ["node_modules.asar.unpacked", "node_modules"].flatMap((dir) =>
        packages.map((relative) => path.join(appRoot, dir, relative))
    )
}

/**
 * Runs ripgrep and hands each line of its output to `onLine`.
 * `stdin` reaches ripgrep in full, then its input closes.
 * Aborting `signal` kills the process and resolves with a null code. `onLine` gets no line after that, since the last one may break off.
 */
export function runRipgrep(
    rgPath: string,
    args: string[],
    options: { cwd?: string; stdin?: string; signal: AbortSignal; onLine?: (line: string) => void }
): Promise<RipgrepExit> {
    return new Promise((resolve, reject) => {
        if (options.signal.aborted) {
            resolve({ code: null, stderr: "" })
            return
        }
        const child = spawn(rgPath, args, { cwd: options.cwd, stdio: ["pipe", "pipe", "pipe"] })
        let stderr = ""
        const onAbort = () => child.kill()
        options.signal.addEventListener("abort", onAbort, { once: true })
        child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk))
        const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity })
        const onLine = options.onLine
        if (onLine)
            lines.on("line", (line) => {
                if (!options.signal.aborted) onLine(line)
            })
        child.stdin.on("error", () => {})
        child.stdin.end(options.stdin ?? "")
        child.on("error", (error) => {
            options.signal.removeEventListener("abort", onAbort)
            reject(error)
        })
        child.on("close", (code) => {
            options.signal.removeEventListener("abort", onAbort)
            resolve({ code: options.signal.aborted ? null : code, stderr })
        })
    })
}
