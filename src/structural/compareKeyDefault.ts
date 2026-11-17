import { compareWord } from "../matching"
import { normalizeWord, reasonsForFoldedMatch } from "../matching/compareWord"
import type { CompareKey, KeyMatch } from "../query/types"
import { DEFAULT_MATCHING, type MatchingOptions, type Query } from "../search/types"

const DIGITS = /^\d+$/

/**
 * Compares a key path literal with a key under the matching defaults that `matching` sets.
 * A literal that makes up a whole segment also matches a key a few edits away, while `matching.fuzzy` holds.
 * A literal of digits alone never matches fuzzily, since `items.100` must leave out `items.101`.
 * A quoted literal matches exactly.
 * `matching.matchWholeWord` changes nothing, since a literal without a wildcard spans a whole key.
 */
export function compareKeyUnder(matching: MatchingOptions): CompareKey {
    return (literal, keyText, how): KeyMatch | undefined => {
        if (how.exact) {
            return compareWord(literal, keyText, true)
        }
        if (how.fuzzy && !DIGITS.test(literal)) {
            return compareWord(literal, keyText, false, matching)
        }
        if (literal === keyText) {
            return { reasons: [] }
        }
        if (normalizeWord(literal, matching) !== normalizeWord(keyText, matching)) {
            return undefined
        }
        return { reasons: reasonsForFoldedMatch(literal, keyText) }
    }
}

export const compareKeyDefault: CompareKey = compareKeyUnder(DEFAULT_MATCHING)

/** The key comparison under the matching defaults of `query`. */
export function compareKeyFor(query: Query): CompareKey {
    return query.kind === "text" && query.matching
        ? compareKeyUnder(query.matching)
        : compareKeyDefault
}
