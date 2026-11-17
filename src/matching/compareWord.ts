import { DEFAULT_MATCHING, type MatchingOptions, type MatchReason } from "../search/types"
import { allowedEdits, editDistance } from "./distance"
import { codePointLength, codePoints, foldCase, foldCaseAndUmlauts, spellOutUmlauts } from "./fold"

export interface WordComparison {
    /** Empty for a match as written. */
    reasons: MatchReason[]
}

/**
 * Compares a query word with a whole candidate, such as a word of a line or a key of a key path.
 * Exact: the candidate must be identical.
 * Otherwise the candidate may differ in case and umlaut spelling, as far as `matching` allows.
 * With `matching.fuzzy`, it may also lie as many edits away as `allowedEdits` grants the query word's length.
 * Returns undefined if the candidate does not match.
 */
export function compareWord(
    queryWord: string,
    candidate: string,
    exact: boolean,
    matching: MatchingOptions = DEFAULT_MATCHING
): WordComparison | undefined {
    if (candidate === queryWord) {
        return { reasons: [] }
    }
    if (exact) {
        return undefined
    }

    const foldedQuery = normalizeWord(queryWord, matching)
    const foldedCandidate = normalizeWord(candidate, matching)
    if (foldedQuery === foldedCandidate) {
        return { reasons: reasonsForFoldedMatch(queryWord, candidate) }
    }
    if (differsInCaseAlone(queryWord, candidate, matching)) {
        return undefined
    }

    const maxEdits = matching.fuzzy ? allowedEdits(codePointLength(queryWord), matching) : 0
    if (maxEdits === 0) {
        return undefined
    }
    const edits = editDistance(codePoints(foldedQuery), codePoints(foldedCandidate), maxEdits)
    if (edits > maxEdits) {
        return undefined
    }
    return { reasons: [{ kind: "fuzzy", query: queryWord, found: candidate, edits }] }
}

/** Folds the case and the umlauts of a text as far as `matching` allows, so two texts that `matching` treats as equal come out equal. */
export function normalizeWord(text: string, matching: MatchingOptions): string {
    if (matching.matchCase) {
        return matching.umlautVariants ? spellOutUmlauts(text) : text.normalize("NFC")
    }
    return matching.umlautVariants ? foldCaseAndUmlauts(text) : foldCase(text)
}

/**
 * True under `matchCase` when the two texts differ in case and nothing else, such as `Secret` and `secret`.
 * Such a pair never counts as a close spelling, so `matchCase` holds under `fuzzy` as well.
 */
export function differsInCaseAlone(a: string, b: string, matching: MatchingOptions): boolean {
    if (!matching.matchCase) {
        return false
    }
    const caseless = { ...matching, matchCase: false }
    return normalizeWord(a, caseless) === normalizeWord(b, caseless)
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
