import type { FileIcons, FileResult, FolderResult, ResultLine, ResultsLayout } from "../messages"
import type { PathFilter } from "../search/globs"
import type { Range } from "../search/types"
import { distinctFolderIndices } from "./distinctFolders"

/** `depth` counts the tree rows that a row hangs from: 0 at the top, 1 below a row at the top, and so on. */
export type Row =
    /**
     * `label` joins the names of a compacted chain of folders, such as `charts/apim`.
     * `folder` holds the path relative to the workspace folder, empty for a workspace folder of a multi-root workspace. `icon` follows the collapsed state.
     * `parent` holds the folders that the list layout shows before the label, undefined in the tree.
     * `parentRanges` and `labelRanges` mark the matched names in `parent` and `label`.
     * `uri` stays missing for a workspace folder. A row without children (`leaf`) shows a folder that the query matched and no result below it.
     */
    | {
          kind: "folder"
          key: string
          depth: number
          label: string
          folder: string
          collapsed: boolean
          icon: string | undefined
          parent: string | undefined
          parentRanges: Range[]
          labelRanges: Range[]
          uri: string | undefined
          leaf: boolean
      }
    /**
     * `folders` holds the folders that the row shows before the file name.
     * In the tree, it holds the chain of folders that leads to this file alone and folds into its row, such as `argocd/applications/gitlab`.
     * It stays empty there for a file that shares its folder row with other results.
     * In the flat layouts, it holds the folder of the file, after the name of its workspace folder in a multi-root workspace.
     * `distinctFolders` indexes the folders that tell the file apart from other files of its name, which a cut path keeps longest.
     * `folderRanges` and `nameRanges` mark the matched names in `folders` and in the file name.
     */
    | {
          kind: "file"
          key: string
          depth: number
          file: FileResult
          folders: string
          distinctFolders: readonly number[]
          collapsed: boolean
          folderRanges: Range[]
          nameRanges: Range[]
      }
    | { kind: "line"; depth: number; file: FileResult; line: ResultLine }

/** A folder of the results with the matched files right in it and the folders below it that hold some. */
interface FolderNode {
    /** The path relative to the workspace folder, empty for the workspace folder. */
    path: string
    name: string
    /** Maps a folder name to its node. */
    folders: Map<string, FolderNode>
    files: FileResult[]
    /** Set when the query matched the name of this folder. */
    match?: FolderResult
}

/** What the layout of rows reads besides the folder tree. */
interface LayoutContext {
    collapsed: ReadonlySet<string>
    /** The matched ranges of the folders down to `folder` in the workspace folder at `rootIndex`, in offsets of `folder`. */
    folderRanges(rootIndex: number, folder: string): Range[]
}

/** The height of every row, code lines included, as in the explorer and the Search view. */
const ROW_HEIGHT_PX = 22

interface FolderGroup {
    key: string
    rootIndex: number
    /** The folder path relative to the workspace folder, split at `/`. */
    segments: string[]
    /** Maps a file URI to its result. */
    files: Map<string, FileResult>
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })

/**
 * Holds the results of one search and lays them out as flat rows.
 * Folders nest as in the explorer.
 * A chain of folders without matched files of their own shares one row, such as `charts/apim`.
 * A chain that leads to one file and nothing else folds into the row of that file, so a lone file costs one row.
 * Inside a folder, its subfolders come first, then its files, each sorted by name. Lines follow their numbers.
 */
export class ResultTree {
    /** Maps a folder key to its group. */
    private readonly groups = new Map<string, FolderGroup>()
    /** Maps a folder key to the result of a folder whose name the query matched. */
    private readonly folderResults = new Map<string, FolderResult>()
    private matches = 0
    private files = 0
    /** Hides the files that it rejects, so an exclusion drops results without a new search. */
    private filter: PathFilter | undefined

    /** Counts the matches of the files and the folders that the filter lets pass. A matched file name counts as one match. */
    get matchCount(): number {
        const folders = this.shownFolderResults().length
        if (!this.filter) return this.matches + folders
        return this.shownFiles().reduce((sum, file) => sum + fileMatches(file), folders)
    }

    get folderCount(): number {
        return this.shownFolderResults().length
    }

    get fileCount(): number {
        if (!this.filter) return this.files
        return this.shownFiles().length
    }

    /** Hides the files that `filter` rejects. `undefined` shows every file. */
    setFilter(filter: PathFilter | undefined): void {
        this.filter = filter
    }

    /** Adds files to the tree. A file already in it gets replaced. */
    add(results: readonly FileResult[]): void {
        for (const file of results) {
            const key = `${file.rootIndex}:${file.folder}`
            let group = this.groups.get(key)
            if (!group) {
                group = {
                    key,
                    rootIndex: file.rootIndex,
                    segments: file.folder === "" ? [] : file.folder.split("/"),
                    files: new Map()
                }
                this.groups.set(key, group)
            }
            const replaced = group.files.get(file.uri)
            if (replaced) {
                this.matches -= fileMatches(replaced)
                this.files--
            }
            group.files.set(file.uri, file)
            this.matches += fileMatches(file)
            this.files++
        }
    }

    /** Adds folders whose name the query matched. A folder already in the tree gets replaced. */
    addFolders(results: readonly FolderResult[]): void {
        for (const folder of results)
            this.folderResults.set(`${folder.rootIndex}:${folder.folder}`, folder)
    }

    /** Replaces the icons of the files and folders that `icons` and `folderIcons` name, keyed by URI. */
    setIcons(
        icons: Readonly<Record<string, FileIcons>>,
        folderIcons: Readonly<Record<string, FileIcons>> = {}
    ): void {
        for (const [key, folder] of this.folderResults) {
            const replacement = folderIcons[folder.uri]
            if (replacement) this.folderResults.set(key, { ...folder, icons: replacement })
        }
        for (const group of this.groups.values()) {
            for (const [uri, file] of group.files) {
                const replacement = icons[uri]
                if (replacement) group.files.set(uri, { ...file, icons: replacement })
            }
        }
    }

    /** Empties the tree and drops its filter. */
    clear(): void {
        this.groups.clear()
        this.folderResults.clear()
        this.filter = undefined
        this.matches = 0
        this.files = 0
    }

    /**
     * Lays out the rows. `collapsed` holds the keys of collapsed folder and file rows.
     * The `list` layout shows no folder rows: every file sits at the top, sorted by its path.
     */
    rows(collapsed: ReadonlySet<string>, layout: ResultsLayout): Row[] {
        const below = this.rangesBelow()
        const context: LayoutContext = {
            collapsed,
            folderRanges: (rootIndex, folder) => [
                ...this.folderRanges(rootIndex, folder),
                ...(below.get(`${rootIndex}:${folder}`) ?? [])
            ]
        }
        if (layout !== "tree") return this.flatRows(context)
        const rows: Row[] = []
        for (const [rootKey, root] of this.workspaceFolders()) {
            const first = firstFile(root) ?? firstMatch(root)
            const rootName = first?.root ?? ""
            if (rootName === "") {
                pushChildren(rows, root, rootKey, 0, context)
                continue
            }
            const key = `${rootKey}:`
            const rootCollapsed = collapsed.has(key)
            const icons = first?.icons?.root
            rows.push({
                kind: "folder",
                key,
                depth: 0,
                label: rootName,
                folder: "",
                collapsed: rootCollapsed,
                icon: rootCollapsed ? icons?.collapsed : icons?.expanded,
                parent: undefined,
                parentRanges: [],
                labelRanges: [],
                uri: undefined,
                leaf: false
            })
            if (!rootCollapsed) pushChildren(rows, root, rootKey, 1, context)
        }
        return rows
    }

    /**
     * Lays out every file at the top, sorted by its path.
     * A matched folder takes a row of its own when no shown file sits below it. The rows of the files below it mark it otherwise.
     */
    private flatRows(context: LayoutContext): Row[] {
        const rows: Row[] = []
        const files = this.shownFiles()
        const holding = new Set(
            files.flatMap((file) =>
                folderChain(file.folder).map((folder) => `${file.rootIndex}:${folder}`)
            )
        )
        const folders = this.shownFolderResults().filter(
            (folder) => !holding.has(`${folder.rootIndex}:${folder.folder}`)
        )
        const distinct = distinctFoldersByFile(files)
        const entries = [
            ...files.map((file) => ({
                file,
                parts: pathParts(file.rootIndex, relativePath(file), true)
            })),
            ...folders.map((folder) => ({
                folder,
                parts: pathParts(folder.rootIndex, folder.folder, false)
            }))
        ].sort((a, b) => compareParts(a.parts, b.parts))
        for (const entry of entries) {
            if ("file" in entry)
                pushFile(
                    rows,
                    entry.file,
                    flatFolders(entry.file),
                    0,
                    context,
                    distinct.get(entry.file) ?? []
                )
            else pushListFolder(rows, entry.folder, context)
        }
        return rows
    }

    /** Collects the matched ranges of `folder` and of the folders above it, which all count offsets from the start of `folder`. */
    private folderRanges(rootIndex: number, folder: string): Range[] {
        if (this.folderResults.size === 0) return []
        return folderChain(folder).flatMap(
            (path) => this.folderResults.get(`${rootIndex}:${path}`)?.ranges ?? []
        )
    }

    /**
     * Maps a folder key to the parts of the matches of the folders below it that fall inside its own path.
     * `apps/web` matches `deploy-apps/web-dev` and marks `apps` in the row of `deploy-apps` as well.
     */
    private rangesBelow(): Map<string, Range[]> {
        const below = new Map<string, Range[]>()
        for (const result of this.folderResults.values()) {
            for (const folder of folderChain(result.folder).slice(0, -1)) {
                const inside = shiftRanges(result.ranges, 0, folder.length)
                if (inside.length === 0) continue
                const key = `${result.rootIndex}:${folder}`
                const known = below.get(key) ?? []
                const added = inside.filter(
                    (range) =>
                        !known.some(
                            (other) => other.start === range.start && other.end === range.end
                        )
                )
                below.set(key, [...known, ...added])
            }
        }
        return below
    }

    private shownFolderResults(): FolderResult[] {
        return [...this.folderResults.values()].filter(
            (folder) => this.filter?.accepts(folder.folder) ?? true
        )
    }

    /** Builds the folder tree of the shown files, one per workspace folder, keyed as folder rows key their paths. */
    private workspaceFolders(): Map<string, FolderNode> {
        const roots = new Map<string, FolderNode>()
        for (const group of [...this.groups.values()].sort(compareGroups)) {
            const files = [...group.files.values()].filter((file) => this.shows(file))
            if (files.length === 0) continue
            const rootKey = String(group.rootIndex)
            let node: FolderNode | undefined = roots.get(rootKey)
            if (!node) {
                node = folderNode("", "")
                roots.set(rootKey, node)
            }
            for (const [index, name] of group.segments.entries()) {
                let child: FolderNode | undefined = node.folders.get(name)
                if (!child) {
                    child = folderNode(group.segments.slice(0, index + 1).join("/"), name)
                    node.folders.set(name, child)
                }
                node = child
            }
            node.files.push(...files)
        }
        for (const folder of this.shownFolderResults()) {
            const rootKey = String(folder.rootIndex)
            let node: FolderNode | undefined = roots.get(rootKey)
            if (!node) {
                node = folderNode("", "")
                roots.set(rootKey, node)
            }
            const segments = folder.folder.split("/")
            for (const [index, name] of segments.entries()) {
                let child: FolderNode | undefined = node.folders.get(name)
                if (!child) {
                    child = folderNode(segments.slice(0, index + 1).join("/"), name)
                    node.folders.set(name, child)
                }
                node = child
            }
            node.match = folder
        }
        return roots
    }

    private shows(file: FileResult): boolean {
        return this.filter?.accepts(relativePath(file)) ?? true
    }

    private shownFiles(): FileResult[] {
        return [...this.groups.values()].flatMap((group) =>
            [...group.files.values()].filter((file) => this.shows(file))
        )
    }
}

/** The path of a file relative to its workspace folder. */
export function relativePath(file: Pick<FileResult, "folder" | "name">): string {
    return file.folder === "" ? file.name : `${file.folder}/${file.name}`
}

function folderNode(path: string, name: string): FolderNode {
    return { path, name, folders: new Map(), files: [] }
}

/** Counts a matched file name as one match beside the matched lines. */
function fileMatches(file: FileResult): number {
    return file.matchCount + (file.pathRanges ? 1 : 0)
}

/** Lists `folder` and the folders above it, the top one first: `a/b` gives `a` and `a/b`. */
function folderChain(folder: string): string[] {
    if (folder === "") return []
    const names = folder.split("/")
    return names.map((_, index) => names.slice(0, index + 1).join("/"))
}

/** Moves `ranges` by `shift` and cuts them to a text of `length`. Drops the ones that end up empty. */
function shiftRanges(ranges: readonly Range[], shift: number, length: number): Range[] {
    return ranges.flatMap((range) => {
        const start = Math.max(0, range.start + shift)
        const end = Math.min(length, range.end + shift)
        return end > start ? [{ start, end }] : []
    })
}

/** The first folder result in or below `node`, in the order of the rows. */
function firstMatch(node: FolderNode): FolderResult | undefined {
    if (node.match) return node.match
    for (const folder of sortedFolders(node)) {
        const match = firstMatch(folder)
        if (match) return match
    }
    return undefined
}

/** The first file in or below `node`, in the order of the rows. */
function firstFile(node: FolderNode): FileResult | undefined {
    for (const folder of sortedFolders(node)) {
        const file = firstFile(folder)
        if (file) return file
    }
    return sortedFiles(node)[0]
}

function sortedFolders(node: FolderNode): FolderNode[] {
    return [...node.folders.values()].sort((a, b) => collator.compare(a.name, b.name))
}

function sortedFiles(node: FolderNode): FileResult[] {
    return [...node.files].sort((a, b) => collator.compare(a.name, b.name))
}

/** Lays out the subfolders of `node`, then its files, at `depth`. `rootKey` names the workspace folder. */
function pushChildren(
    rows: Row[],
    node: FolderNode,
    rootKey: string,
    depth: number,
    context: LayoutContext
): void {
    for (const folder of sortedFolders(node)) pushFolder(rows, folder, rootKey, depth, context)
    for (const file of sortedFiles(node)) pushFile(rows, file, "", depth, context)
}

function flatFolders(file: FileResult): string {
    return [file.root, file.folder].filter((part) => part !== "").join("/")
}

/** Groups the files by name and picks, for each file of a shared name, the folders that tell it apart. */
function distinctFoldersByFile(files: readonly FileResult[]): Map<FileResult, number[]> {
    const byName = new Map<string, FileResult[]>()
    for (const file of files) byName.set(file.name, [...(byName.get(file.name) ?? []), file])
    const distinct = new Map<FileResult, number[]>()
    for (const group of byName.values()) {
        if (group.length < 2) continue
        const indices = distinctFolderIndices(group.map((file) => flatFolders(file).split("/")))
        group.forEach((file, index) => distinct.set(file, indices[index] ?? []))
    }
    return distinct
}

/**
 * `folders` ends with the folder of the file: the tree shows the last folders of its path, the list its whole path after the workspace folder.
 * Ranges in the path of the file shift by the difference in length.
 */
function pushFile(
    rows: Row[],
    file: FileResult,
    folders: string,
    depth: number,
    context: LayoutContext,
    distinctFolders: readonly number[] = []
): void {
    const fileCollapsed = context.collapsed.has(file.uri)
    const nameStart = file.folder === "" ? 0 : file.folder.length + 1
    const pathRanges = file.pathRanges ?? []
    rows.push({
        kind: "file",
        key: file.uri,
        depth,
        file,
        folders,
        distinctFolders,
        collapsed: fileCollapsed,
        folderRanges: shiftRanges(
            [...context.folderRanges(file.rootIndex, file.folder), ...pathRanges],
            folders.length - file.folder.length,
            folders.length
        ),
        nameRanges: shiftRanges(pathRanges, -nameStart, file.name.length)
    })
    if (fileCollapsed) return
    for (const block of file.blocks) {
        for (const line of block)
            if (!isBlankContext(line)) rows.push({ kind: "line", depth: depth + 1, file, line })
    }
}

/** A context line of whitespace alone takes no row. */
function isBlankContext(line: ResultLine): boolean {
    return line.ranges.length === 0 && line.text.trim() === ""
}

/**
 * A folder without files of its own and with one subfolder shares its row with that subfolder, as the built-in Search view compacts them.
 * A chain that ends in a folder holding one file and no subfolder takes no row: it folds into the row of that file.
 */
function pushFolder(
    rows: Row[],
    folder: FolderNode,
    rootKey: string,
    depth: number,
    context: LayoutContext
): void {
    const names = [folder.name]
    let last = folder
    for (let only = soleSubfolder(last); only; only = soleSubfolder(last)) {
        names.push(only.name)
        last = only
    }
    const [loneFile] = last.files
    if (loneFile && last.files.length === 1 && last.folders.size === 0) {
        pushFile(rows, loneFile, names.join("/"), depth, context)
        return
    }
    const key = `${rootKey}:${last.path}`
    const leaf = last.files.length === 0 && last.folders.size === 0
    const folderCollapsed = !leaf && context.collapsed.has(key)
    const below = firstFile(last) ?? firstMatch(last)
    const icons = below?.icons?.folders?.[last.path.split("/").length - 1]
    const label = names.join("/")
    rows.push({
        kind: "folder",
        key,
        depth,
        label,
        folder: last.path,
        collapsed: folderCollapsed,
        icon: folderCollapsed || leaf ? icons?.collapsed : icons?.expanded,
        parent: undefined,
        parentRanges: [],
        labelRanges: shiftRanges(
            context.folderRanges(Number(rootKey), last.path),
            label.length - last.path.length,
            label.length
        ),
        uri: last.match?.uri ?? folderUri(firstFile(last), last.path),
        leaf
    })
    if (!folderCollapsed) pushChildren(rows, last, rootKey, depth + 1, context)
}

/** A matched folder without results below it, in the list layout: its name after its dimmed parent folders. */
function pushListFolder(rows: Row[], folder: FolderResult, context: LayoutContext): void {
    const slash = folder.folder.lastIndexOf("/")
    const label = folder.folder.slice(slash + 1)
    const parent = [folder.root, slash < 0 ? "" : folder.folder.slice(0, slash)]
        .filter((part) => part !== "")
        .join("/")
    const ranges = context.folderRanges(folder.rootIndex, folder.folder)
    const icons = folder.icons?.folders?.at(-1)
    rows.push({
        kind: "folder",
        key: `${folder.rootIndex}:${folder.folder}`,
        depth: 0,
        label,
        folder: folder.folder,
        collapsed: false,
        icon: icons?.collapsed,
        parent,
        parentRanges: shiftRanges(ranges, parent.length - (slash < 0 ? 0 : slash), parent.length),
        labelRanges: shiftRanges(ranges, -(slash + 1), label.length),
        uri: folder.uri,
        leaf: true
    })
}

/** The URI of `folder`, cut from the URI of `file` below it, whose path segments hold no `/` of their own. */
function folderUri(file: FileResult | undefined, folder: string): string | undefined {
    if (!file) return undefined
    const below = relativePath(file).split("/").length - folder.split("/").length
    return file.uri.split("/").slice(0, -below).join("/")
}

function soleSubfolder(node: FolderNode): FolderNode | undefined {
    if (node.files.length > 0 || node.folders.size !== 1) return undefined
    return node.folders.values().next().value
}

/** Workspace folders keep the order of the workspace. A parent folder sorts before its subfolders, so the rows follow the folder tree. */
function compareGroups(a: FolderGroup, b: FolderGroup): number {
    if (a.rootIndex !== b.rootIndex) return a.rootIndex - b.rootIndex
    const shared = Math.min(a.segments.length, b.segments.length)
    for (let i = 0; i < shared; i++) {
        const order = collator.compare(a.segments[i] ?? "", b.segments[i] ?? "")
        if (order !== 0) return order
    }
    return a.segments.length - b.segments.length
}

/** A path in the list layout, split at `/`. `file` tells whether its last name names a file. */
interface PathParts {
    rootIndex: number
    names: string[]
    file: boolean
}

function pathParts(rootIndex: number, path: string, file: boolean): PathParts {
    return { rootIndex, names: path.split("/"), file }
}

/**
 * Workspace folders keep the order of the workspace.
 * Inside one, paths compare folder by folder, and a file sorts before the subfolders beside it, as the built-in Search view sorts its list.
 */
function compareParts(a: PathParts, b: PathParts): number {
    if (a.rootIndex !== b.rootIndex) return a.rootIndex - b.rootIndex
    for (let i = 0; ; i++) {
        const aEnd = i === a.names.length - 1
        const bEnd = i === b.names.length - 1
        const aFile = aEnd && a.file
        const bFile = bEnd && b.file
        if (aFile !== bFile) return aFile ? -1 : 1
        const order = collator.compare(a.names[i] ?? "", b.names[i] ?? "")
        if (order !== 0) return order
        if (aEnd || bEnd) return Number(bEnd) - Number(aEnd)
    }
}

/** Returns the top offset of each row in pixels, plus the total height as the last entry. */
export function rowOffsets(rows: readonly Row[]): number[] {
    return Array.from({ length: rows.length + 1 }, (_, index) => index * ROW_HEIGHT_PX)
}

/** Returns the index of the row that covers `top`, found by binary search over `offsets`. */
export function rowAt(offsets: readonly number[], top: number): number {
    let low = 0
    let high = offsets.length - 2
    while (low < high) {
        const middle = (low + high + 1) >> 1
        if ((offsets[middle] ?? 0) <= top) low = middle
        else high = middle - 1
    }
    return Math.max(0, low)
}

/**
 * Splits an excerpt into plain and marked parts. Ranges count offsets of the whole line, so they shift by the excerpt offset.
 * A marked part carries the index of its range in `match`. A range outside the excerpt gives no part.
 */
export function highlightParts(line: ResultLine): { text: string; match?: number }[] {
    const parts: { text: string; match?: number }[] = []
    let cursor = 0
    line.ranges.forEach((range, match) => {
        const start = Math.min(Math.max(range.start - line.offset, cursor), line.text.length)
        const end = Math.min(Math.max(range.end - line.offset, start), line.text.length)
        if (start > cursor) parts.push({ text: line.text.slice(cursor, start) })
        if (end > start) parts.push({ text: line.text.slice(start, end), match })
        cursor = end
    })
    if (cursor < line.text.length) parts.push({ text: line.text.slice(cursor) })
    return parts
}

/** Builds the summary line, such as "4 results in 4 files" or "5 results in 4 files and 1 folder". */
export function resultSummary(
    matchCount: number,
    fileCount: number,
    cappedAt?: number,
    folderCount = 0
): string {
    if (matchCount === 0) return "No results"
    const files = [
        ...(fileCount > 0 || folderCount === 0 ? [count(fileCount, "file", "files")] : []),
        ...(folderCount > 0 ? [count(folderCount, "folder", "folders")] : [])
    ].join(" and ")
    if (cappedAt !== undefined)
        return `First ${cappedAt.toLocaleString("en-US")} results in ${files}. Narrow the search to see the rest.`
    return `${matchCount.toLocaleString("en-US")} ${matchCount === 1 ? "result" : "results"} in ${files}`
}

function count(value: number, one: string, many: string): string {
    return `${value.toLocaleString("en-US")} ${value === 1 ? one : many}`
}
