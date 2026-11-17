// The contract between the query parser, the matching defaults, the search engines and the view.
// Offsets count UTF-16 code units, as JavaScript strings do.

import type { KeyPathPattern, QueryError } from "../query/types"

export interface Range {
    start: number
    end: number
}

/** Says why a match differs from the query word. The context menu on a match shows it. */
export type MatchReason =
    | { kind: "fuzzy"; query: string; found: string; edits: number }
    | { kind: "umlaut"; query: string; found: string }
    | { kind: "case"; query: string; found: string }

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

export const DEFAULT_MATCHING: MatchingOptions = {
    matchCase: false,
    matchWholeWord: false,
    umlautVariants: true,
    fuzzy: true,
    // The AUTO fuzziness of Elasticsearch (https://www.elastic.co/guide/en/elasticsearch/reference/current/common-options.html#fuzziness).
    oneEditMinLetters: 3,
    twoEditsMinLetters: 6
}

export type TextPiece =
    /** A run of letters and digits. Quotes make it exact: case-sensitive, without umlaut variants and fuzzy matches. */
    | { kind: "word"; value: string; exact: boolean }
    /** Any other character run, escaped characters included. */
    | { kind: "literal"; value: string }
    /** An unescaped `*` outside a regex: any run of characters inside one line. */
    | { kind: "wildcard" }

export type Query =
    /** A query between two slashes. ripgrep compiles `source` with the syntax of the Rust regex crate. */
    | { kind: "regex"; raw: string; source: string }
    | {
          kind: "text"
          raw: string
          pieces: TextPiece[]
          /** Missing means `DEFAULT_MATCHING`. */
          matching?: MatchingOptions
          /** Missing when the query breaks the key path grammar. `keyPathError` then says why. */
          keyPath?: KeyPathPattern
          keyPathError?: QueryError
      }

export interface LineMatch {
    /** 0-based line number, with lines ended by `\n`, `\r\n` or a lone `\r` as in VS Code. */
    line: number
    ranges: Range[]
    reasons: MatchReason[]
    /** The key path of the matched node. Key path engines set it for "Copy key path". */
    keyPath?: string[]
    /** True shows `keyPath` on the row after the line text. The YAML, JSON and TOML engines set it for a query that uses the key path language. */
    showKeyPath?: boolean
}

export interface FileInfo {
    uri: string
    /** Relative to its workspace folder, with `/` as separator. */
    relativePath: string
    languageId: string
}

export interface SearchFile extends FileInfo {
    text: string
}

/**
 * Reads a query and a file and returns its matches.
 * Other extensions register engines through the API that `activate` returns.
 */
export interface SearchEngine {
    readonly id: string
    accepts(file: FileInfo, query: Query): boolean
    search(file: SearchFile, query: Query, signal: AbortSignal): LineMatch[] | Promise<LineMatch[]>
}
