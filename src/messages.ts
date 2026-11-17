import type { Hint } from "./query/types"
import type { FileFields } from "./search/globs"
import type { MatchReason, Range } from "./search/types"

export interface ResultLine {
    /** 0-based line number. */
    line: number
    /** The line, or an excerpt of it starting at `offset` when the line runs long. */
    text: string
    offset: number
    /** False on a context line. A matched line can hold no range, as a match of the empty regex `^` does. */
    match: boolean
    /** Matched ranges in offsets of the whole line. */
    ranges: Range[]
    /** Why a matching default stretched the query on this line. Missing without such a reason. */
    reasons?: MatchReason[]
    /** The key path of the matched node, set by key path engines. */
    keyPath?: string[]
    /**
     * True when the row shows `keyPath` after the line text, as for a key of a YAML, JSON or TOML file.
     * A member chain in code shows no key path, since the line spells the chain.
     */
    showKeyPath?: boolean
}

export interface FileResult {
    uri: string
    /** Position of the workspace folder, so roots keep the order of the workspace. */
    rootIndex: number
    /** Name of the workspace folder in a multi-root workspace, empty with one folder. */
    root: string
    /** Folder of the file relative to its workspace folder, with `/` as separator. Empty at the root. */
    folder: string
    name: string
    languageId: string
    matchCount: number
    /** Runs of consecutive lines in ascending order. Context of close matches shares one block. */
    blocks: ResultLine[][]
    /** Set by the view provider from the active file icon theme. */
    icons?: FileIcons
}

/** Icon definition ids of the active file icon theme. A missing id shows an empty icon slot. */
export interface FileIcons {
    file?: string
    /** The row of the workspace folder in a multi-root workspace. */
    root?: FolderIcons
    /** The rows of the folders above the file, one per folder of its path, the top folder first. */
    folders?: FolderIcons[]
}

export interface FolderIcons {
    collapsed?: string
    expanded?: string
}

/** How the view draws an icon definition of the file icon theme. */
export type IconLook =
    /** An SVG or PNG file. With `currentColor`, the image masks the text color of the row. */
    | { kind: "image"; uri: string; currentColor: boolean }
    /** A character of an icon font. `size` holds a CSS font size such as `150%`, relative to the row text. */
    | { kind: "glyph"; character: string; family: string; size: string; color?: string }

export interface IconFontFace {
    family: string
    sources: { uri: string; format: string }[]
    weight: string
    style: string
}

/** The fonts and the icon definitions of the active file icon theme, keyed by definition id. */
export interface IconTable {
    fonts: IconFontFace[]
    icons: Record<string, IconLook>
}

/**
 * How a search ended.
 * `capped`: the search stopped at `limit` matched lines.
 * `blocked`: the query ran no search, and a hint says why.
 * `failed`: the search stopped on an error that the output channel names. The results sent before it stay.
 */
export type SearchStatus = "complete" | "capped" | "blocked" | "empty" | "noFolder" | "failed"

export type ViewMessage =
    | { type: "ready" }
    | ({ type: "search"; query: string } & FileFields)
    | { type: "cancelSearch" }
    | { type: "open"; uri: string; line: number; range?: Range; preserveFocus: boolean }
    | { type: "copy"; text: string }
    /** Copies the whole line, since the view holds an excerpt of a long line. */
    | { type: "copyLine"; uri: string; line: number }

/**
 * How the results show.
 * `tree`: files in their folder tree.
 * `list`: every file at the top, its name after its dimmed folders.
 */
export type ResultsLayout = "tree" | "list"

/** Workbench settings that the view follows. */
export interface ViewSettings {
    /** `workbench.tree.indent`: how far a tree row steps right of its parent. */
    treeIndentPx: number
    /** `search.searchOnType`: typing in the query or the file fields searches once typing pauses. */
    searchOnType: boolean
    /** `search.searchOnTypeDebouncePeriod`: how long typing pauses before the search starts. */
    searchOnTypeDebounceMs: number
}

export type HostMessage =
    | { type: "focus" }
    | { type: "settings"; settings: ViewSettings }
    | { type: "resultsLayout"; layout: ResultsLayout }
    | { type: "searchStarted"; searchId: number }
    | { type: "results"; searchId: number; files: FileResult[] }
    | { type: "hint"; searchId: number; hint: Hint }
    | { type: "searchDone"; searchId: number; status: SearchStatus; limit: number }
    /** Sets the file icon theme and the icons of the files that the view holds, keyed by file URI. Without a theme, rows show empty icon slots. */
    | { type: "icons"; theme: IconTable | undefined; files: Record<string, FileIcons> }
