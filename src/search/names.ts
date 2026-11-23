import { findInLine } from "../matching"
import type { Query, Range } from "./types"

/** Caps the names that a matcher remembers, since a workspace may hold millions of distinct names. */
const NAME_MEMO_MAX_ENTRIES = 50_000

/**
 * Matches a text query against the paths of files and folders, with the matching defaults of the lines.
 * A path matches when a match ends inside its last name: `dev` finds the folder `web-dev` and leaves the files below it out.
 * A query with `/` spans folders: `apps/web` finds `deploy-apps/web-dev`.
 * A regex query matches no path.
 */
export class NameMatcher {
    private readonly spansFolders: boolean
    /** Maps a name to its matched ranges, for a query without `/`. Many files share a name, such as `index.ts`. */
    private readonly byName = new Map<string, Range[] | undefined>()

    constructor(private readonly query: Query) {
        this.spansFolders = query.raw.includes("/")
    }

    /** Returns the matched ranges in `path`, a path with `/` as separator, or undefined when its last name holds no match. */
    match(path: string): Range[] | undefined {
        if (this.query.kind !== "text" || this.query.pieces.length === 0) return undefined
        const nameStart = path.lastIndexOf("/") + 1
        if (this.spansFolders) return this.matchText(path, nameStart)
        const name = path.slice(nameStart)
        let ranges = this.byName.get(name)
        if (ranges === undefined && !this.byName.has(name)) {
            ranges = this.matchText(name, 0)
            if (this.byName.size >= NAME_MEMO_MAX_ENTRIES) this.byName.clear()
            this.byName.set(name, ranges)
        }
        return ranges?.map((range) => ({
            start: range.start + nameStart,
            end: range.end + nameStart
        }))
    }

    /** The ranges of the matches in `text` that end past `from`. */
    private matchText(text: string, from: number): Range[] | undefined {
        if (this.query.kind !== "text") return undefined
        const ranges = findInLine(text, this.query.pieces, this.query.matching)
            .flatMap((match) => match.ranges)
            .filter((range) => range.end > from && range.end > range.start)
        return ranges.length > 0 ? ranges : undefined
    }
}
