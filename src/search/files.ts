import * as vscode from "vscode"
import { LISTING_RELIST_DELAY_DURATION_MS } from "./config"
import { expandBraces } from "./globs"
import { runRipgrep } from "./ripgrep"
import { ripgrepWalkArgs, WalkExcludes } from "./walk"
import type { SearchRoot } from "./workspaceEngine"

export interface RootFile {
    root: SearchRoot
    /** Relative to the root, with `/` as separator. */
    relativePath: string
}

/**
 * Lists every file of every root, ignored and excluded files included, minus the `.git` folders.
 * A root on disk gets listed by ripgrep. Without ripgrep, or on another file system, `workspace.findFiles` lists it.
 * A root that cannot be listed, such as a folder deleted since the workspace opened, adds no files and a log line.
 * `onFile` receives each file once it got listed, before the promise resolves.
 * It receives the files of the last complete listing of a root at once, since listing a large root takes longer than searching most of its files.
 * A file that the new listing drops, such as one deleted since, reaches `onFile` as well. Reading it then fails, or it shows up in the results of this search alone.
 * After `trustListings`, a root whose files stayed as last listed skips the new listing, see there.
 */
export async function collectFiles(
    roots: readonly SearchRoot[],
    rgPath: string | undefined,
    signal: AbortSignal,
    log: (message: string) => void,
    onFile: (file: RootFile) => void = () => {}
): Promise<RootFile[]> {
    const lists = await Promise.all(
        roots.map((root) =>
            listRoot(root, rgPath, signal, log, onFile).catch((error: unknown) => {
                if (!signal.aborted)
                    log(`Could not list the files of ${root.uri}: ${String(error)}`)
                return []
            })
        )
    )
    return lists.flat()
}

interface Listing {
    /** The settings that the listing followed, see `SearchRoot.walk`. */
    walk: string
    relativePaths: string[]
    /** The value of `listingGeneration` when the listing started. */
    generation: number
}

/** The last complete listing of each root, by the URI of the root. */
const lastListings = new Map<string, Listing>()
/** The roots whose listing runs in the background, by the URI of the root. */
const relistings = new Set<string>()
/** The roots that a search took the last listing of since their last background listing, by the URI of the root. */
const reused = new Map<string, SearchRoot>()
let relistTimer: NodeJS.Timeout | undefined
let listingsTrusted = false
/** Counts the calls of `forgetListings`. A listing that started before the last call may miss a change. */
let listingGeneration = 0

/**
 * Lets a search take the last listing of a root as it stands.
 * The caller must call `forgetListings` once a file got created or deleted, or an ignore file changed.
 * A missed call leaves a listing stale until `relistReused` replaces it.
 */
export function trustListings(): void {
    listingsTrusted = true
}

/** The files whose text ripgrep reads to decide what it lists. */
const IGNORE_FILE = /(^|\/)(\.gitignore|\.ignore|\.rgignore|\.git\/info\/exclude)$/

/** True if a change to the text of the file at `path` may change what a listing holds. `path` must use `/` as separator. */
export function isIgnoreFile(path: string): boolean {
    return IGNORE_FILE.test(path)
}

/** Makes the next search of every root wait for a new listing. */
export function forgetListings(): void {
    listingGeneration++
}

async function listRoot(
    root: SearchRoot,
    rgPath: string | undefined,
    signal: AbortSignal,
    log: (message: string) => void,
    onFile: (file: RootFile) => void
): Promise<RootFile[]> {
    const walk = JSON.stringify(root.walk)
    const last = lastListings.get(root.uri)
    const known = new Set(last?.walk === walk ? last.relativePaths : [])
    for (const relativePath of known) onFile({ root, relativePath })
    if (listingsTrusted && last?.walk === walk && last.generation === listingGeneration) {
        reused.set(root.uri, root)
        return last.relativePaths.map((relativePath) => ({ root, relativePath }))
    }
    return listAndKeep(root, rgPath, signal, log, (file) => {
        if (!known.has(file.relativePath)) onFile(file)
    })
}

/**
 * Lists anew each root whose last listing a search took, once no call came for `LISTING_RELIST_DELAY_DURATION_MS`.
 * No search waits for it. Each root lists at most once at a time.
 * A caller should call it once its search ended, since starting ripgrep holds up the thread for a few milliseconds.
 */
export function relistReused(rgPath: string | undefined, log: (message: string) => void): void {
    clearTimeout(relistTimer)
    relistTimer = setTimeout(() => relistNow(rgPath, log), LISTING_RELIST_DELAY_DURATION_MS)
    relistTimer.unref()
}

function relistNow(rgPath: string | undefined, log: (message: string) => void): void {
    for (const root of reused.values()) {
        if (relistings.has(root.uri)) continue
        relistings.add(root.uri)
        listAndKeep(root, rgPath, new AbortController().signal, log, () => {})
            .catch((error: unknown) =>
                log(`Could not list the files of ${root.uri}: ${String(error)}`)
            )
            .finally(() => relistings.delete(root.uri))
    }
    reused.clear()
}

/** Lists a root anew and keeps the listing for the next search, unless the search got cancelled. */
async function listAndKeep(
    root: SearchRoot,
    rgPath: string | undefined,
    signal: AbortSignal,
    log: (message: string) => void,
    onFile: (file: RootFile) => void
): Promise<RootFile[]> {
    const generation = listingGeneration
    const files = await listRootAnew(root, rgPath, signal, log, onFile)
    if (!signal.aborted)
        lastListings.set(root.uri, {
            walk: JSON.stringify(root.walk),
            relativePaths: files.map((file) => file.relativePath),
            generation
        })
    return files
}

async function listRootAnew(
    root: SearchRoot,
    rgPath: string | undefined,
    signal: AbortSignal,
    log: (message: string) => void,
    onFile: (file: RootFile) => void
): Promise<RootFile[]> {
    if (rgPath && root.fsPath !== undefined)
        return listWithRipgrep(rgPath, root, root.fsPath, signal, log, onFile)
    const files = await listWithFindFiles(root, signal)
    files.forEach(onFile)
    return files
}

async function listWithRipgrep(
    rgPath: string,
    root: SearchRoot,
    cwd: string,
    signal: AbortSignal,
    log: (message: string) => void,
    onFile: (file: RootFile) => void
): Promise<RootFile[]> {
    const files: RootFile[] = []
    const toSlash =
        process.platform === "win32"
            ? (path: string) => path.replace(/\\/g, "/")
            : (path: string) => path
    const exit = await runRipgrep(rgPath, ["--files", ...ripgrepWalkArgs(root.walk)], {
        cwd,
        signal,
        onLine: (line) => {
            const file = { root, relativePath: toSlash(line) }
            files.push(file)
            onFile(file)
        }
    })
    if (exit.code === 2) log(`ripgrep could not list every file in ${cwd}: ${exit.stderr.trim()}`)
    return files
}

async function listWithFindFiles(root: SearchRoot, signal: AbortSignal): Promise<RootFile[]> {
    const rootUri = vscode.Uri.parse(root.uri)
    // findFiles takes one exclude glob. A brace group joins the patterns, and VS Code globs cannot nest braces.
    // A glob with a brace left after the expansion, such as a `{` without its `}`, gets tested on the listed paths.
    const globs = root.walk.excludeGlobs.flatMap(expandBraces)
    const flat = globs.filter((glob) => !/[{}]/.test(glob))
    const leftover = new WalkExcludes(globs.filter((glob) => /[{}]/.test(glob)))
    const exclude = flat.length > 0 ? `{${flat.join(",")}}` : undefined
    const cancellation = new vscode.CancellationTokenSource()
    const onAbort = () => cancellation.cancel()
    signal.addEventListener("abort", onAbort, { once: true })
    try {
        const uris = await vscode.workspace.findFiles(
            new vscode.RelativePattern(rootUri, "**/*"),
            exclude,
            undefined,
            cancellation.token
        )
        const prefix = rootUri.path.endsWith("/") ? rootUri.path : `${rootUri.path}/`
        return uris
            .filter((uri) => uri.path.startsWith(prefix))
            .map((uri) => ({ root, relativePath: uri.path.slice(prefix.length) }))
            .filter((file) => !leftover.excludes(file.relativePath))
    } catch (error) {
        if (signal.aborted) return []
        throw error
    } finally {
        signal.removeEventListener("abort", onAbort)
        cancellation.dispose()
    }
}
