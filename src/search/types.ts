// The contract between the query parser, the matching defaults, the search engines and the view.
// The parts that other extensions see sit in `src/api.ts`.

import type * as api from "../api"
import type { KeyPathPattern, QueryError } from "../query/types"

export type {
    FileInfo,
    LineMatch,
    MatchingOptions,
    MatchReason,
    Range,
    RegexQuery,
    SearchFile,
    TextPiece
} from "../api"

export const DEFAULT_MATCHING: api.MatchingOptions = {
    matchCase: false,
    matchWholeWord: false,
    umlautVariants: true,
    fuzzy: true,
    // The AUTO fuzziness of Elasticsearch (https://www.elastic.co/guide/en/elasticsearch/reference/current/common-options.html#fuzziness).
    oneEditMinLetters: 3,
    twoEditsMinLetters: 6
}

/** Like the `TextQuery` of `src/api.ts`, with the key path that the query parser read. Other extensions never see the key path. */
export interface TextQuery extends api.TextQuery {
    /** Missing when the query breaks the key path grammar. `keyPathError` then says why. */
    keyPath?: KeyPathPattern
    keyPathError?: QueryError
}

export type Query = api.RegexQuery | TextQuery

/** Like the `SearchEngine` of `src/api.ts`. Its text queries carry the key path. */
export interface SearchEngine {
    readonly id: string
    accepts(file: api.FileInfo, query: Query): boolean
    search(
        file: api.SearchFile,
        query: Query,
        signal: AbortSignal
    ): api.LineMatch[] | Promise<api.LineMatch[]>
}
