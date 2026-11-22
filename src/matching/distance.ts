import { DEFAULT_MATCHING, type MatchingOptions } from "../search/types"
import { assert } from "./assert"

/** Edits that a query word allows, by its length in code points and the thresholds of `matching`. */
export function allowedEdits(
    queryWordLength: number,
    matching: Pick<MatchingOptions, "oneEditMinLetters" | "twoEditsMinLetters"> = DEFAULT_MATCHING
): number {
    if (queryWordLength >= matching.twoEditsMinLetters) {
        return 2
    }
    if (queryWordLength >= matching.oneEditMinLetters) {
        return 1
    }
    return 0
}

/**
 * Counts the edits between two code point sequences: inserts, deletes, replacements and swaps of two neighbours.
 * It computes the optimal string alignment distance, which edits no substring twice: `ca` to `abc` takes 3 edits.
 * Stops once the distance exceeds `maxEdits` and returns `maxEdits + 1` then.
 * `bLength` lets a caller pass a reused array, of which the first `bLength` code points count.
 */
export function editDistance(
    a: readonly number[],
    b: readonly number[],
    maxEdits: number,
    bLength = b.length
): number {
    assert(maxEdits >= 0, `maxEdits must not be negative, got ${maxEdits}`)
    const tooFar = maxEdits + 1
    if (Math.abs(a.length - bLength) > maxEdits) {
        return tooFar
    }

    ensureRowLength(bLength + 1)
    let rowBeforePrevious = rows[0]
    let previousRow = rows[1]
    let row = rows[2]
    for (let column = 0; column <= bLength; column++) {
        previousRow[column] = column
    }
    for (let i = 1; i <= a.length; i++) {
        row[0] = i
        let rowMinimum = i
        for (let j = 1; j <= bLength; j++) {
            const replaceCost = a[i - 1] === b[j - 1] ? 0 : 1
            let distance = Math.min(
                previousRow[j]! + 1,
                row[j - 1]! + 1,
                previousRow[j - 1]! + replaceCost
            )
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
                distance = Math.min(distance, rowBeforePrevious[j - 2]! + 1)
            }
            row[j] = distance
            rowMinimum = Math.min(rowMinimum, distance)
        }
        // Every later row costs at least this row's minimum, swaps included.
        if (rowMinimum > maxEdits) {
            return tooFar
        }
        const recycled = rowBeforePrevious
        rowBeforePrevious = previousRow
        previousRow = row
        row = recycled
    }
    return Math.min(previousRow[bLength]!, tooFar)
}

// Reused across calls, since fuzzy matching runs the distance for many words per line.
let rows: [Int32Array, Int32Array, Int32Array] = [
    new Int32Array(64),
    new Int32Array(64),
    new Int32Array(64)
]

function ensureRowLength(length: number): void {
    if (rows[0].length < length) {
        rows = [new Int32Array(length), new Int32Array(length), new Int32Array(length)]
    }
}
