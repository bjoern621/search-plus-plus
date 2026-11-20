// The contract between Search++ and the extensions that add search engines to it, as API.md describes.
// The module imports nothing. An extension may copy it into its own source.
// Offsets count UTF-16 code units, as JavaScript strings do.

/** The `apiVersion` that this module describes. */
export const API_VERSION = 1

/**
 * The API that the `activate` function of Search++ returns to other extensions.
 * Get it with `vscode.extensions.getExtension<SearchPlusPlusApi>("bjoern621.search-plus-plus")?.activate()`.
 */
export interface SearchPlusPlusApi {
    /**
     * Grows by one with each change that breaks an extension written against an earlier version.
     * A new member keeps the number.
     * To call a member that later versions add, check for it first.
     */
    readonly apiVersion: number

    /**
     * Adds a search engine to every search that starts after the call.
     * Throws if the id is empty or an engine with the same id is registered already.
     * Disposing the result removes the engine.
     */
    registerEngine(engine: SearchEngine): Disposable

    /**
     * Adds key path search for a file type whose keys `files.readKeys` reads.
     * Search++ matches each key path against the query with the matching defaults and the match reasons of its YAML, JSON and TOML search.
     * Throws if the id is empty or taken, if an extension lacks its leading dot or if `files` names no language and no extension.
     * Disposing the result removes the file type.
     */
    registerKeyPathFiles(files: KeyPathFiles): Disposable
}

/** Matches `vscode.Disposable`, so the result may go into `context.subscriptions`. */
export interface Disposable {
    dispose(): void
}

/**
 * A file type whose files hold a tree of keys, such as INI, HCL or XML.
 * Search++ searches a file of this type once its language ID or its extension matches, for a query that the key path grammar accepts.
 */
export interface KeyPathFiles {
    /** Must be unique across every search engine and file type that Search++ knows. */
    readonly id: string
    /** The language IDs of VS Code that mark a file of this type, such as `ini`. */
    readonly languageIds: readonly string[]
    /** The file extensions that mark a file of this type, each with its leading dot, such as `.ini`. Case does not matter. */
    readonly extensions: readonly string[]
    /**
     * Calls `visit` for every node of `text` with its key path, in any order.
     * An array item takes its index as key, such as "0", to follow the YAML, JSON and TOML search.
     * A node visited twice at the same `start` keeps one match.
     * Should read past broken parts. A file with a typo then still yields its other keys.
     * `visit` throws once `signal` fires. The error must leave `readKeys` uncaught, which ends the search of this file.
     */
    readKeys(text: string, visit: VisitKeyPath, signal: AbortSignal): void
}

/**
 * Receives one node of a key tree.
 * `path` lists its keys from the root, `["server", "port"]` for the key `port` below `server`.
 * Search++ reads `path` during the call alone. The caller may reuse the array for the next node.
 * `start` and `end` are file offsets of the text that a match highlights, usually the key.
 * A range across several lines gets cut at the end of its first line.
 * An empty range shows the line without a highlight.
 */
export type VisitKeyPath = (path: readonly string[], start: number, end: number) => void

/**
 * Reads a query and a file and returns its matches.
 * For key path search, `registerKeyPathFiles` leaves the matching to Search++.
 */
export interface SearchEngine {
    /** Must be unique across every search engine and file type that Search++ knows. */
    readonly id: string
    /** Says whether the engine searches `file` for `query`. Should decide without reading the file, since Search++ asks for every file. */
    accepts(file: FileInfo, query: Query): boolean
    /**
     * Returns the matches of `query` in `file`.
     * Search++ logs an error that the call throws.
     * It drops a match outside the file and a range outside its line.
     * A search that `signal` aborts may return anything, since Search++ discards it.
     */
    search(file: SearchFile, query: Query, signal: AbortSignal): LineMatch[] | Promise<LineMatch[]>
}

export interface FileInfo {
    uri: string
    /** Relative to its workspace folder, with `/` as separator. */
    relativePath: string
    languageId: string
}

export interface SearchFile extends FileInfo {
    /** The text in the editor for a file with unsaved changes, the text on disk otherwise. */
    text: string
}

export type Query = RegexQuery | TextQuery

/** A query between two slashes. */
export interface RegexQuery {
    kind: "regex"
    raw: string
    /** The text between the slashes, in the syntax of the Rust regex crate that ripgrep uses. */
    source: string
}

/** Every query that is no regex query. */
export interface TextQuery {
    kind: "text"
    /** The query as typed. */
    raw: string
    pieces: TextPiece[]
    /** Missing means the defaults of the `searchPlusPlus` settings. */
    matching?: MatchingOptions
}

export type TextPiece =
    /** A run of letters and digits. Quotes make it exact: case-sensitive, without umlaut variants and fuzzy matches. */
    | { kind: "word"; value: string; exact: boolean }
    /** Any other character run, escaped characters included. */
    | { kind: "literal"; value: string }
    /** An unescaped `*` outside a regex: any run of characters inside one line. */
    | { kind: "wildcard" }

/**
 * The matching defaults that a text query applies, set in the extension settings.
 * Quotes around a word set aside `matchCase`, `umlautVariants` and `fuzzy` for that word.
 */
export interface MatchingOptions {
    /** A word matches its own case alone. */
    matchCase: boolean
    /** A word matches whole words of a line alone. Key paths compare whole keys either way. */
    matchWholeWord: boolean
    /** Each umlaut and its spelled-out form match each other, `ä` and `ae` for example. */
    umlautVariants: boolean
    /** A word also matches a word a few edits away. */
    fuzzy: boolean
    /** A query word of this many letters or more allows one edit. */
    oneEditMinLetters: number
    /** A query word of this many letters or more allows two edits. */
    twoEditsMinLetters: number
}

export interface LineMatch {
    /** 0-based line number, with lines ended by `\n`, `\r\n` or a lone `\r` as in VS Code. */
    line: number
    /** Offsets inside the line. */
    ranges: Range[]
    /** Empty when the match spells the query as written. */
    reasons: MatchReason[]
    /** The key path of the matched node, for "Copy key path". */
    keyPath?: string[]
    /** True shows `keyPath` on the row after the line text. Key path search sets it for a query that uses the key path language. */
    showKeyPath?: boolean
}

export interface Range {
    start: number
    end: number
}

/** Says why a match differs from the query word. The context menu on a match shows it. */
export type MatchReason =
    | { kind: "fuzzy"; query: string; found: string; edits: number }
    | { kind: "umlaut"; query: string; found: string }
    | { kind: "case"; query: string; found: string }
