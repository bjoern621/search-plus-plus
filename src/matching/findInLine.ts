import {
    DEFAULT_MATCHING,
    type MatchingOptions,
    type MatchReason,
    type Range,
    type TextPiece
} from "../search/types"
import { assert, never } from "./assert"
import { differsInCaseAlone, normalizeWord, reasonsForFoldedMatch } from "./compareWord"
import { allowedEdits, editDistance } from "./distance"
import {
    codePointLength,
    codePoints,
    foldCase,
    foldCaseAndUmlauts,
    foldText,
    isCharacterBoundary,
    originalRange,
    type FoldedText
} from "./fold"

export interface LineTextMatch {
    /** One range over the whole match, wildcard runs included. */
    ranges: Range[]
    reasons: MatchReason[]
}

/**
 * Finds every non-overlapping match of the pieces in one line, from left to right.
 * A word matches inside line words, whatever their case and umlaut spelling: `grav` finds `gravitee`.
 * Its close spellings span whole words or camelCase parts, see `fuzzyOccurrences`.
 * An exact word matches exactly, inside line words as well.
 * A literal matches whatever its case.
 * `matching` turns each of these defaults off, and `matchWholeWord` keeps every word to whole line words.
 * A wildcard matches the shortest run of characters that lets the rest match.
 * Pieces without a word or a literal match nothing.
 * Caches the compiled pieces per array, so the caller must not change the array between calls.
 */
export function findInLine(
    line: string,
    pieces: TextPiece[],
    matching: MatchingOptions = DEFAULT_MATCHING
): LineTextMatch[] {
    const query = compiledQuery(pieces, matching)
    if (query.pieces.length === 0 || !containsRequiredTexts(line, query)) {
        return []
    }

    const search = new LineSearch(line, query.pieces, matching)
    const matches: LineTextMatch[] = []
    let from = 0
    for (;;) {
        const match = search.firstMatchFrom(from)
        if (match === undefined) {
            return matches
        }
        matches.push({ ranges: [{ start: match.start, end: match.end }], reasons: match.reasons })
        from = match.end
    }
}

interface FuzzyWordPiece {
    kind: "word"
    value: string
    folded: string
    foldedCodePoints: number[]
    /** The word as `normalizeWord` folds it under the matching options. */
    normalized: string
    /** True when the options fold less than `foldCaseAndUmlauts` does, so each find gets checked against `normalized`. */
    strict: boolean
    maxEdits: number
    /** Maps a line word to its close spellings, at most `CLOSE_SPELLING_CACHE_MAX_WORDS` entries. */
    closeSpellingsByWord: Map<string, CloseSpelling[]>
}

type CompiledPiece =
    | { kind: "exactWord"; value: string }
    | { kind: "exactLiteral"; value: string }
    | FuzzyWordPiece
    | { kind: "literal"; value: string; folded: string }
    | { kind: "wildcard" }

interface CompiledQuery {
    /** Never starts or ends with a wildcard and never holds two in a row. */
    pieces: CompiledPiece[]
    /** Texts that every matching line contains as written. */
    requiredTexts: string[]
}

interface Occurrence {
    start: number
    end: number
    edits: number
    reasons: MatchReason[]
}

interface Tail {
    end: number
    reasons: MatchReason[]
}

const CLOSE_SPELLING_CACHE_MAX_WORDS = 50_000

const WORD = /[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu
const ASCII_WITHOUT_LETTERS = /^[\x00-\x40\x5b-\x60\x7b-\x7f]*$/
const UPPER_CASE = /[\p{Lu}\p{Lt}]/u
const DIGIT = /\p{N}/u
const MARK = /\p{M}/u
const WORD_CHAR_BEFORE = /[\p{L}\p{N}\p{M}]$/u
const WORD_CHAR_AFTER = /^[\p{L}\p{N}\p{M}]/u

const compiledQueries = new WeakMap<
    TextPiece[],
    { matching: MatchingOptions; query: CompiledQuery }
>()

function compiledQuery(pieces: TextPiece[], matching: MatchingOptions): CompiledQuery {
    const cached = compiledQueries.get(pieces)
    if (cached !== undefined && sameMatching(cached.matching, matching)) {
        return cached.query
    }
    const query = compileQuery(pieces, matching)
    compiledQueries.set(pieces, { matching, query })
    return query
}

function sameMatching(a: MatchingOptions, b: MatchingOptions): boolean {
    return (Object.keys(a) as (keyof MatchingOptions)[]).every((key) => a[key] === b[key])
}

function compileQuery(pieces: TextPiece[], matching: MatchingOptions): CompiledQuery {
    const compiled: CompiledPiece[] = []
    for (const piece of pieces) {
        // A lazy wildcard at either end matches the empty run and adds nothing to the match.
        if (
            piece.kind === "wildcard" &&
            (compiled.length === 0 || compiled.at(-1)!.kind === "wildcard")
        ) {
            continue
        }
        compiled.push(compilePiece(piece, matching))
    }
    if (compiled.at(-1)?.kind === "wildcard") {
        compiled.pop()
    }
    return { pieces: compiled, requiredTexts: compiled.flatMap(requiredText) }
}

function compilePiece(piece: TextPiece, matching: MatchingOptions): CompiledPiece {
    switch (piece.kind) {
        case "wildcard":
            return piece
        case "literal":
            assert(piece.value.length > 0, "a literal piece must not be empty")
            if (matching.matchCase) {
                return { kind: "exactLiteral", value: piece.value }
            }
            return { kind: "literal", value: piece.value, folded: foldCase(piece.value) }
        case "word": {
            assert(piece.value.length > 0, "a word piece must not be empty")
            if (
                piece.exact ||
                (matching.matchCase && !matching.umlautVariants && !matching.fuzzy)
            ) {
                return { kind: "exactWord", value: piece.value }
            }
            const folded = foldCaseAndUmlauts(piece.value)
            return {
                kind: "word",
                value: piece.value,
                folded,
                foldedCodePoints: codePoints(folded),
                normalized: normalizeWord(piece.value, matching),
                strict: matching.matchCase || !matching.umlautVariants,
                maxEdits: matching.fuzzy ? allowedEdits(codePointLength(piece.value), matching) : 0,
                closeSpellingsByWord: new Map()
            }
        }
        default:
            return never(`unknown text piece ${JSON.stringify(piece)}`)
    }
}

/** Folding leaves ASCII other than letters alone, so a literal of such characters has to appear as written. */
function requiredText(piece: CompiledPiece): string[] {
    if (piece.kind === "exactWord" || piece.kind === "exactLiteral") {
        return [piece.value]
    }
    if (piece.kind === "literal" && ASCII_WITHOUT_LETTERS.test(piece.value)) {
        return [piece.value]
    }
    return []
}

function containsRequiredTexts(line: string, query: CompiledQuery): boolean {
    return query.requiredTexts.every((text) => line.includes(text))
}

/** Matches the compiled pieces against one line and keeps what it computed for the next match. */
class LineSearch {
    private caseFolded?: FoldedText
    private fullyFolded?: FoldedText
    private words?: Range[]
    private readonly occurrencesByPiece: (Occurrence[] | undefined)[] = []
    /** Per wildcard index: the lowest position from which the rest failed to match. */
    private readonly failedAfterWildcardFrom = new Map<number, number>()
    /** Keys `pieceIndex * (line.length + 1) + position` for which the rest failed to match. */
    private readonly failedAt = new Set<number>()

    constructor(
        private readonly line: string,
        private readonly pieces: CompiledPiece[],
        private readonly matching: MatchingOptions
    ) {}

    firstMatchFrom(from: number): (Range & Tail) | undefined {
        const firstOccurrences = this.occurrences(0)
        for (
            let index = firstAtOrAfter(firstOccurrences, from);
            index < firstOccurrences.length;
            index++
        ) {
            const first = firstOccurrences[index]!
            const tail = this.matchRest(1, first.end)
            if (tail !== undefined) {
                return {
                    start: first.start,
                    end: tail.end,
                    reasons: [...first.reasons, ...tail.reasons]
                }
            }
        }
        return undefined
    }

    /** Matches the pieces from `pieceIndex` on, starting at `position`, or after it if that piece is a wildcard. */
    private matchRest(pieceIndex: number, position: number): Tail | undefined {
        if (pieceIndex === this.pieces.length) {
            return { end: position, reasons: [] }
        }
        const afterWildcard = this.pieces[pieceIndex]!.kind === "wildcard"
        if (this.hasFailed(pieceIndex, position, afterWildcard)) {
            return undefined
        }

        const occurrenceIndex = afterWildcard ? pieceIndex + 1 : pieceIndex
        const occurrences = this.occurrences(occurrenceIndex)
        for (
            let index = firstAtOrAfter(occurrences, position);
            index < occurrences.length;
            index++
        ) {
            const occurrence = occurrences[index]!
            if (!afterWildcard && occurrence.start !== position) {
                break
            }
            const tail = this.matchRest(occurrenceIndex + 1, occurrence.end)
            if (tail !== undefined) {
                return { end: tail.end, reasons: [...occurrence.reasons, ...tail.reasons] }
            }
        }

        this.recordFailure(pieceIndex, position, afterWildcard)
        return undefined
    }

    // After a wildcard, a later position offers a subset of the occurrences, so a failure holds for every later position.
    private hasFailed(pieceIndex: number, position: number, afterWildcard: boolean): boolean {
        if (afterWildcard) {
            return position >= (this.failedAfterWildcardFrom.get(pieceIndex) ?? Infinity)
        }
        return this.failedAt.has(pieceIndex * (this.line.length + 1) + position)
    }

    private recordFailure(pieceIndex: number, position: number, afterWildcard: boolean): void {
        if (afterWildcard) {
            const lowest = this.failedAfterWildcardFrom.get(pieceIndex) ?? Infinity
            this.failedAfterWildcardFrom.set(pieceIndex, Math.min(lowest, position))
            return
        }
        this.failedAt.add(pieceIndex * (this.line.length + 1) + position)
    }

    /** Occurrences of one piece, sorted by start, then fewest edits, then longest. */
    private occurrences(pieceIndex: number): Occurrence[] {
        let occurrences = this.occurrencesByPiece[pieceIndex]
        if (occurrences === undefined) {
            occurrences = this.findOccurrences(this.pieces[pieceIndex]!)
            occurrences.sort((a, b) => a.start - b.start || a.edits - b.edits || b.end - a.end)
            this.occurrencesByPiece[pieceIndex] = occurrences
        }
        return occurrences
    }

    private findOccurrences(piece: CompiledPiece): Occurrence[] {
        switch (piece.kind) {
            case "exactWord":
                return this.wholeWordsOnly(exactOccurrences(this.line, piece.value))
            case "exactLiteral":
                return exactOccurrences(this.line, piece.value)
            case "literal":
                return foldedOccurrences(this.caseFold(), piece.folded, () => [])
            case "word": {
                const folded = this.fullFold()
                const found = this.wholeWordsOnly(
                    this.allowedFinds(
                        piece,
                        foldedOccurrences(folded, piece.folded, (range) =>
                            reasonsForFoldedMatch(
                                piece.value,
                                this.line.slice(range.start, range.end)
                            )
                        )
                    )
                )
                if (piece.maxEdits === 0) {
                    return found
                }
                const fuzzy = fuzzyOccurrences(this.line, folded, this.lineWords(), piece, found)
                return found.concat(this.wholeWordsOnly(this.allowedFinds(piece, fuzzy)))
            }
            case "wildcard":
                return never("a wildcard has no occurrences of its own")
        }
    }

    /**
     * Keeps the finds that the matching options allow, since the search folds case and umlauts whatever the options say.
     * Recounts the edits of a close spelling on the text as the options fold it.
     */
    private allowedFinds(piece: FuzzyWordPiece, finds: Occurrence[]): Occurrence[] {
        if (!piece.strict) {
            return finds
        }
        const allowed: Occurrence[] = []
        for (const find of finds) {
            const text = this.line.slice(find.start, find.end)
            const normalized = normalizeWord(text, this.matching)
            if (normalized === piece.normalized) {
                allowed.push({
                    ...find,
                    edits: 0,
                    reasons: reasonsForFoldedMatch(piece.value, text)
                })
                continue
            }
            if (piece.maxEdits === 0 || differsInCaseAlone(piece.value, text, this.matching)) {
                continue
            }
            const edits = editDistance(
                codePoints(piece.normalized),
                codePoints(normalized),
                piece.maxEdits
            )
            if (edits <= piece.maxEdits) {
                allowed.push({
                    ...find,
                    edits,
                    reasons: [{ kind: "fuzzy", query: piece.value, found: text, edits }]
                })
            }
        }
        return allowed
    }

    private wholeWordsOnly(finds: Occurrence[]): Occurrence[] {
        if (!this.matching.matchWholeWord) {
            return finds
        }
        return finds.filter(
            (find) =>
                !WORD_CHAR_BEFORE.test(this.line.slice(Math.max(0, find.start - 2), find.start)) &&
                !WORD_CHAR_AFTER.test(this.line.slice(find.end, find.end + 2))
        )
    }

    private caseFold(): FoldedText {
        this.caseFolded ??= foldText(this.line, false)
        return this.caseFolded
    }

    private fullFold(): FoldedText {
        this.fullyFolded ??= foldText(this.line, true)
        return this.fullyFolded
    }

    private lineWords(): Range[] {
        if (this.words === undefined) {
            this.words = []
            WORD.lastIndex = 0
            for (let word = WORD.exec(this.line); word !== null; word = WORD.exec(this.line)) {
                this.words.push({ start: word.index, end: WORD.lastIndex })
            }
        }
        return this.words
    }
}

/** Returns the index of the first occurrence starting at or after `position`. */
function firstAtOrAfter(occurrences: Occurrence[], position: number): number {
    let low = 0
    let high = occurrences.length
    while (low < high) {
        const middle = (low + high) >>> 1
        if (occurrences[middle]!.start < position) {
            low = middle + 1
        } else {
            high = middle
        }
    }
    return low
}

function exactOccurrences(line: string, value: string): Occurrence[] {
    const occurrences: Occurrence[] = []
    for (let start = line.indexOf(value); start !== -1; start = line.indexOf(value, start + 1)) {
        occurrences.push({ start, end: start + value.length, edits: 0, reasons: [] })
    }
    return occurrences
}

/** Finds `value` in the folded line, overlaps included, and drops each find that splits a character. */
function foldedOccurrences(
    folded: FoldedText,
    value: string,
    reasonsFor: (range: Range) => MatchReason[]
): Occurrence[] {
    const occurrences: Occurrence[] = []
    for (
        let start = folded.text.indexOf(value);
        start !== -1;
        start = folded.text.indexOf(value, start + 1)
    ) {
        const end = start + value.length
        if (!isCharacterBoundary(folded, start) || !isCharacterBoundary(folded, end)) {
            continue
        }
        const range = originalRange(folded, start, end)
        occurrences.push({ ...range, edits: 0, reasons: reasonsFor(range) })
    }
    return occurrences
}

/**
 * Finds the close spellings of a query word.
 * A close spelling spans whole parts of one line word, where a part starts at a camelCase or a letter-digit boundary.
 * `Gröse` finds `Größe` and `gravitie` finds `Gravitee` in `getGraviteeConfig`, but `Gröse` finds no part of `Größenordnung`.
 * Fuzzy matching at any offset inside a part would let a short word match a slice of almost every long word.
 * Elasticsearch also compares a fuzzy query with whole tokens.
 * A line word that holds the query word as written gets no fuzzy match.
 * Of the close spellings in one line word, those with the fewest edits stay: `decodr` finds `Decoder` in `utf8Decoder`, not `8Decoder`.
 */
function fuzzyOccurrences(
    line: string,
    folded: FoldedText,
    words: Range[],
    piece: FuzzyWordPiece,
    foldedFinds: Occurrence[]
): Occurrence[] {
    const occurrences: Occurrence[] = []
    const minSpanUnits = piece.foldedCodePoints.length - piece.maxEdits
    let findIndex = 0
    for (const word of words) {
        while (findIndex < foldedFinds.length && foldedFinds[findIndex]!.start < word.start) {
            findIndex++
        }
        if (findIndex < foldedFinds.length && foldedFinds[findIndex]!.start < word.end) {
            continue
        }
        if (folded.foldedOffsets[word.end]! - folded.foldedOffsets[word.start]! < minSpanUnits) {
            continue
        }

        for (const span of cachedCloseSpellings(piece, line.slice(word.start, word.end))) {
            const start = word.start + span.start
            const end = word.start + span.end
            const found = line.slice(start, end)
            const reasons: MatchReason[] =
                span.edits === 0
                    ? reasonsForFoldedMatch(piece.value, found)
                    : [{ kind: "fuzzy", query: piece.value, found, edits: span.edits }]
            occurrences.push({ start, end, edits: span.edits, reasons })
        }
    }
    return occurrences
}

interface CloseSpelling extends Range {
    edits: number
}

// Identifiers repeat throughout a file, so most words of a line hit the cache.
function cachedCloseSpellings(piece: FuzzyWordPiece, word: string): CloseSpelling[] {
    let spellings = piece.closeSpellingsByWord.get(word)
    if (spellings === undefined) {
        spellings = closeSpellings(piece, word)
        if (piece.closeSpellingsByWord.size >= CLOSE_SPELLING_CACHE_MAX_WORDS) {
            piece.closeSpellingsByWord.clear()
        }
        piece.closeSpellingsByWord.set(word, spellings)
    }
    return spellings
}

/** Returns the spans of `word` within the allowed edits of the query word, offsets relative to the word. */
function closeSpellings(piece: FuzzyWordPiece, word: string): CloseSpelling[] {
    const folded = foldText(word, true)
    const queryLength = piece.foldedCodePoints.length
    // Code points never outnumber code units and take at most two each, so code units bound the length of a span.
    const minSpanUnits = queryLength - piece.maxEdits
    const maxSpanUnits = 2 * (queryLength + piece.maxEdits)
    const spellings: CloseSpelling[] = []
    const boundaries = partBoundaries(word)
    for (let from = 0; from < boundaries.length - 1; from++) {
        const spanStart = folded.foldedOffsets[boundaries[from]!]!
        for (let to = from + 1; to < boundaries.length; to++) {
            const spanEnd = folded.foldedOffsets[boundaries[to]!]!
            if (spanEnd - spanStart > maxSpanUnits) {
                break
            }
            if (spanEnd - spanStart < minSpanUnits) {
                continue
            }
            const candidate = codePoints(folded.text, spanStart, spanEnd)
            if (Math.abs(candidate.length - queryLength) > piece.maxEdits) {
                continue
            }
            const edits = editDistance(piece.foldedCodePoints, candidate, piece.maxEdits)
            if (edits <= piece.maxEdits) {
                spellings.push({ start: boundaries[from]!, end: boundaries[to]!, edits })
            }
        }
    }
    const fewestEdits = Math.min(...spellings.map((spelling) => spelling.edits))
    return spellings.filter((spelling) => spelling.edits === fewestEdits)
}

type CharacterClass = "upper" | "lower" | "digit"

/**
 * Returns the offsets where the parts of a word start, 0 and the word's length included.
 * A part starts at an upper-case letter after a lower-case one, at a switch between letters and digits,
 * and at the last capital of an acronym followed by a lower-case letter: `HTTPServer` splits into `HTTP` and `Server`.
 */
function partBoundaries(word: string): number[] {
    const offsets: number[] = []
    const classes: CharacterClass[] = []
    for (let index = 0; index < word.length;) {
        const point = word.codePointAt(index)!
        const characterClass = classify(point)
        if (characterClass !== undefined) {
            offsets.push(index)
            classes.push(characterClass)
        }
        index += point > 0xffff ? 2 : 1
    }

    const boundaries = [0]
    for (let index = 1; index < classes.length; index++) {
        const before = classes[index - 1]
        const current = classes[index]
        const after = classes[index + 1]
        const camelCase = before === "lower" && current === "upper"
        const letterDigitSwitch = (before === "digit") !== (current === "digit")
        const acronymEnd = before === "upper" && current === "upper" && after === "lower"
        if (camelCase || letterDigitSwitch || acronymEnd) {
            boundaries.push(offsets[index]!)
        }
    }
    boundaries.push(word.length)
    return boundaries
}

/** Returns undefined for a combining mark, which belongs to the character before it. */
function classify(point: number): CharacterClass | undefined {
    if (point < 0x80) {
        if (point >= 0x30 && point <= 0x39) {
            return "digit"
        }
        return point >= 0x41 && point <= 0x5a ? "upper" : "lower"
    }
    const character = String.fromCodePoint(point)
    if (MARK.test(character)) {
        return undefined
    }
    if (UPPER_CASE.test(character)) {
        return "upper"
    }
    return DIGIT.test(character) ? "digit" : "lower"
}
