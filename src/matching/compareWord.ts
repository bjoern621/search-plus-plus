import type { MatchReason } from "../search/types"
import { allowedEdits, editDistance } from "./distance"
import { codePointLength, codePoints, foldCase, foldCaseAndUmlauts } from "./fold"

export interface WordComparison {
    /** Empty for a match as written. */
    reasons: MatchReason[]
}

/**
 * Compares a query word with a whole candidate, such as a word of a line or a key of a key path.
 * Exact: the candidate must be identical.
 * Otherwise the candidate may differ in case and umlaut spelling.
 * After folding both, it may also lie as many edits away as `allowedEdits` grants the query word's length.
 * Returns undefined if the candidate does not match.
 */
export function compareWord(
    queryWord: string,
    candidate: string,
    exact: boolean
): WordComparison | undefined {
    if (candidate === queryWord) {
        return { reasons: [] }
    }
    if (exact) {
        return undefined
    }

    const foldedQuery = foldCaseAndUmlauts(queryWord)
    const foldedCandidate = foldCaseAndUmlauts(candidate)
    if (foldedQuery === foldedCandidate) {
        return { reasons: reasonsForFoldedMatch(queryWord, candidate) }
    }

    const maxEdits = allowedEdits(codePointLength(queryWord))
    if (maxEdits === 0) {
        return undefined
    }
    const edits = editDistance(codePoints(foldedQuery), codePoints(foldedCandidate), maxEdits)
    if (edits > maxEdits) {
        return undefined
    }
    return { reasons: [{ kind: "fuzzy", query: queryWord, found: candidate, edits }] }
}

/**
 * Says why `found` matched `query` after folding case and umlauts.
 * The umlaut reason covers a case difference as well.
 * The caller must pass two texts whose folded forms are equal.
 */
export function reasonsForFoldedMatch(query: string, found: string): MatchReason[] {
    if (found.normalize("NFC") === query.normalize("NFC")) {
        return []
    }
    if (foldCase(found) === foldCase(query)) {
        return [{ kind: "case", query, found }]
    }
    return [{ kind: "umlaut", query, found }]
}
