import { foldCase } from "../matching"
import type { Query } from "../search/types"
import { parseQuery } from "./parseQuery"

/** A word needs this many characters to match a path, since a single letter starts some word of nearly every path. */
const PATH_WORD_MIN_CHARS = 2

/** A word of a text query as typed, with the folded text that a path must hold. `pathText` stays undefined for a word that never matches a path. */
interface QueryWord {
    raw: string
    pathText: string | undefined
}

/**
 * Narrows a text query to each file by the words that match the path of the file.
 * The query splits into words at white space outside double quotes.
 * A word matches a path when the path holds it at the start of a word, in any case: `staging` and `apps/stag` match `deploy-apps/staging/web.yaml`.
 * The words that the path holds leave the query.
 * The other words search the lines of the file.
 * A file whose path holds none or all of the words gets the whole query.
 * A quoted word and a word with `*` or `\` search lines alone.
 */
export class PathWords {
    private readonly words: QueryWord[]
    /** The narrowed queries, keyed by the indexes of the words that a path holds. */
    private readonly narrowed = new Map<string, Query>()

    constructor(private readonly query: Query) {
        this.words = query.kind === "text" ? splitWords(query.raw) : []
    }

    /** Returns the query that searches the lines of the file at `relativePath`, a path with `/` as separator. */
    queryFor(relativePath: string): Query {
        if (this.words.length < 2) return this.query
        const path = foldCase(relativePath)
        const inPath = this.words.flatMap((word, index) =>
            word.pathText !== undefined && holdsWordStart(path, word.pathText) ? [index] : []
        )
        if (inPath.length === 0 || inPath.length === this.words.length) return this.query
        const key = inPath.join(",")
        let query = this.narrowed.get(key)
        if (query === undefined) {
            const rest = this.words.filter((_word, index) => !inPath.includes(index))
            query = parseQuery(
                rest.map((word) => word.raw).join(" "),
                this.query.kind === "text" ? this.query.matching : undefined
            )
            this.narrowed.set(key, query)
        }
        return query
    }
}

/** Splits `raw` at white space outside double quotes. An escaped white space character stays inside its word. */
export function splitWords(raw: string): QueryWord[] {
    const words: QueryWord[] = []
    let current = ""
    let quoted = false
    const chars = Array.from(raw)
    const end = () => {
        if (current !== "") words.push({ raw: current, pathText: pathTextOf(current) })
        current = ""
    }
    for (let index = 0; index < chars.length; index++) {
        const char = chars[index]!
        if (char === "\\" && index + 1 < chars.length) {
            current += char + chars[++index]
            continue
        }
        if (char === '"') quoted = !quoted
        if (!quoted && /\s/u.test(char)) {
            end()
            continue
        }
        current += char
    }
    end()
    return words
}

function pathTextOf(word: string): string | undefined {
    if (/["*\\]/.test(word) || Array.from(word).length < PATH_WORD_MIN_CHARS) return undefined
    return foldCase(word)
}

/** True when `path` holds `word` at its start or after a character that ends a word. A word that starts with such a character, as `/dev` does, may sit anywhere. */
function holdsWordStart(path: string, word: string): boolean {
    const startsWord = isWordChar(word[0])
    for (let at = path.indexOf(word); at !== -1; at = path.indexOf(word, at + 1)) {
        if (!startsWord || at === 0 || !isWordChar(path[at - 1])) return true
    }
    return false
}

function isWordChar(char: string | undefined): boolean {
    return char !== undefined && /[\p{L}\p{N}]/u.test(char)
}
