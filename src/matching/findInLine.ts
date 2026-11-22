import { LINE_BREAK } from "../search/results"
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
    codePointsInto,
    foldCase,
    foldCaseAndUmlauts,
    foldText,
    foldedString,
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
 * `file` names the folds of the file that holds the line. The search then takes the close spellings that `lineFilter` found in that file.
 */
export function findInLine(
    line: string,
    pieces: TextPiece[],
    matching: MatchingOptions = DEFAULT_MATCHING,
    file?: FileFolds
): LineTextMatch[] {
    const query = compiledQuery(pieces, matching)
    if (query.pieces.length === 0 || !containsRequiredTexts(line, query)) {
        return []
    }

    const search = new LineSearch(line, query.pieces, matching, file)
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

/**
 * Tests cheaply whether a line of `text` can hold a match of the pieces.
 * The test takes a line by its index among the lines that `splitLines` splits `text` into.
 * A caller runs `findInLine` on the lines that pass.
 * A line that fails the test gets no match from `findInLine`. A line that passes may get none as well.
 * Returns undefined when no line of `text` can hold a match.
 */
export function lineFilter(
    text: string | FileFolds,
    pieces: TextPiece[],
    matching: MatchingOptions = DEFAULT_MATCHING
): ((lineIndex: number) => boolean) | undefined {
    const query = compiledQuery(pieces, matching)
    if (query.pieces.length === 0) {
        return undefined
    }
    const file = typeof text === "string" ? new FileFolds(text) : text
    let passing: Uint8Array | undefined
    for (const piece of query.pieces) {
        if (piece.kind === "wildcard") {
            continue
        }
        const marks = linesHolding(piece, file)
        if (passing === undefined) {
            passing = marks
        } else {
            for (let line = 0; line < passing.length; line++) {
                passing[line]! &= marks[line]!
            }
        }
        if (!passing.includes(1)) {
            return undefined
        }
    }
    assert(passing !== undefined, "a compiled query holds a piece other than a wildcard")
    const lines = passing
    return (lineIndex) => lines[lineIndex] === 1
}

/**
 * Marks with 1 each line of the file that may hold an occurrence of the piece.
 * A file with a combining mark at the start of a line gets every line marked, since its folds join that mark to the line break before it.
 */
function linesHolding(
    piece: Exclude<CompiledPiece, { kind: "wildcard" }>,
    file: FileFolds
): Uint8Array {
    if (file.marksAfterLineBreaks) {
        return new Uint8Array(file.lineCount()).fill(1)
    }
    switch (piece.kind) {
        case "exactWord":
        case "exactLiteral":
            return file.linesHolding(piece.value, "none")
        case "literal":
            return file.linesHolding(piece.folded, "case")
        case "word": {
            const marks = file.linesHolding(piece.folded, "full")
            if (piece.maxEdits > 0) {
                const { lines } = file.words()
                for (const word of closeSpelledWords(piece, file)) {
                    for (const line of lines[word]!) {
                        marks[line] = 1
                    }
                }
            }
            return marks
        }
    }
}

/**
 * The indexes in `file.words()` of the words with a close spelling of the piece, as `fuzzyOccurrences` looks for them.
 * Keeps their close spellings in `file`, see `FileFolds.closeSpellingsOf`.
 */
function closeSpelledWords(piece: FuzzyWordPiece, file: FileFolds): number[] {
    const minSpanUnits = piece.foldedCodePoints.length - piece.maxEdits
    const hitWords: number[] = []
    const spellingsByWord = new Map<string, CloseSpelling[]>()
    const { words, folded, foldedLengths, letters, ascii } = file.words()
    for (let index = 0; index < words.length; index++) {
        if (foldedLengths[index]! < minSpanUnits) {
            continue
        }
        // A letter of the query word that the word lacks takes at least one edit, as in `lacksTooManyCharacters`.
        if (bitCount(piece.letters & ~letters[index]!) > piece.maxEdits) {
            continue
        }
        const asciiWord = ascii[index] === 1
        const boundaries = file.partBoundariesOf(index)
        // Each span covers a whole part. An ASCII part folds to as many code units as it holds.
        if (
            asciiWord &&
            shortestPart(boundaries) > piece.foldedCodePoints.length + piece.maxEdits
        ) {
            continue
        }
        const spellings = closeSpellingsOfFolded(
            piece,
            words[index]!,
            folded[index]!,
            asciiWord,
            boundaries
        )
        if (spellings.length > 0) {
            hitWords.push(index)
            spellingsByWord.set(words[index]!, spellings)
        }
    }
    file.keepCloseSpellings(piece, spellingsByWord)
    return hitWords
}

/** One bit per letter from `a` to `z` that `folded` holds. */
function letterBits(folded: string): number {
    let bits = 0
    for (let index = 0; index < folded.length; index++) {
        const letter = folded.charCodeAt(index) - 0x61
        if (letter >= 0 && letter < 26) {
            bits |= 1 << letter
        }
    }
    return bits
}

function shortestPart(boundaries: readonly number[]): number {
    let shortest = Infinity
    for (let index = 1; index < boundaries.length; index++) {
        shortest = Math.min(shortest, boundaries[index]! - boundaries[index - 1]!)
    }
    return shortest
}

function bitCount(bits: number): number {
    let count = 0
    for (let rest = bits; rest !== 0; rest &= rest - 1) {
        count++
    }
    return count
}

/** The distinct words of a file, split as `lineWords` splits a line. */
interface FileWords {
    words: string[]
    /** Per word: the word as `foldedString` folds it with umlauts spelled out. */
    folded: string[]
    /** Per word: its length in code units once folded. */
    foldedLengths: number[]
    /** Per word: the bits of `letterBits` for its fold. */
    letters: Int32Array
    /** Per word: 1 if it holds ASCII alone. */
    ascii: Uint8Array
    /** Per word: its `partBoundaries`, see `FileFolds.partBoundariesOf`. */
    boundaries: (number[] | undefined)[]
    /** Per word: the indexes of the lines that hold it, ascending. */
    lines: number[][]
}

/** The ways of folding a file, as `linesHolding` reads them: none, case alone, or case and umlauts. */
type Fold = "none" | "case" | "full"

/**
 * The folds of a whole file and the lines of its words, computed on first use.
 * A line folds to a line of the file's fold, since folding works per character and no character spans a line break.
 * A combining mark at the start of a line breaks that: the file joins it to the line break before it.
 */
export class FileFolds {
    readonly marksAfterLineBreaks: boolean
    private distinctWords?: FileWords
    private caseFolded?: string
    private fullyFolded?: string
    private ascii?: boolean
    private readonly lineStarts = new Map<Fold, number[]>()
    /** The close spellings that `closeSpelledWords` found per piece, keyed by the compiled piece so they go once the search drops it. */
    private readonly closeSpellings = new WeakMap<
        FuzzyWordPiece,
        ReadonlyMap<string, CloseSpelling[]>
    >()

    constructor(readonly text: string) {
        this.marksAfterLineBreaks = LINE_BREAK_BEFORE_MARK.test(text)
    }

    isAscii(): boolean {
        this.ascii ??= ASCII_ONLY.test(this.text)
        return this.ascii
    }

    /** The number of lines that `splitLines` splits the text into, plus an empty last line after a final line break. */
    lineCount(): number {
        return this.lineStartsOf("none").length
    }

    words(): FileWords {
        this.distinctWords ??= this.collectWords()
        return this.distinctWords
    }

    /** The `partBoundaries` of the word at `index` in `words()`, computed on first use. */
    partBoundariesOf(index: number): readonly number[] {
        const { words, boundaries } = this.words()
        let found = boundaries[index]
        if (found === undefined) {
            found = partBoundaries(words[index]!)
            boundaries[index] = found
        }
        return found
    }

    /** Keeps the words of the file with a close spelling of `piece`, mapped to their close spellings. */
    keepCloseSpellings(
        piece: FuzzyWordPiece,
        spellingsByWord: ReadonlyMap<string, CloseSpelling[]>
    ): void {
        this.closeSpellings.set(piece, spellingsByWord)
    }

    /** The map that `keepCloseSpellings` kept for `piece`. Undefined until then. */
    closeSpellingsOf(piece: FuzzyWordPiece): ReadonlyMap<string, CloseSpelling[]> | undefined {
        return this.closeSpellings.get(piece)
    }

    fullyFoldedText(): string {
        this.fullyFolded ??= foldedString(this.text, true)
        return this.fullyFolded
    }

    /** Marks with 1 each line whose fold holds `value`, which must hold no line break. */
    linesHolding(value: string, fold: Fold): Uint8Array {
        const text = this.foldedText(fold)
        const starts = this.lineStartsOf(fold)
        const marks = new Uint8Array(starts.length)
        let line = 0
        for (let at = text.indexOf(value); at !== -1;) {
            line = lineHoldingOffset(starts, at, line)
            marks[line] = 1
            if (line + 1 === starts.length) {
                break
            }
            at = text.indexOf(value, starts[line + 1])
        }
        return marks
    }

    private foldedText(fold: Fold): string {
        switch (fold) {
            case "none":
                return this.text
            case "case":
                this.caseFolded ??= foldedString(this.text, false)
                return this.caseFolded
            case "full":
                return this.fullyFoldedText()
        }
    }

    /** Per line of the folded text, the offset where it starts. Folding keeps every offset of ASCII text. Its folds share the starts of the text. */
    private lineStartsOf(fold: Fold): number[] {
        const key = this.isAscii() ? "none" : fold
        let starts = this.lineStarts.get(key)
        if (starts === undefined) {
            starts = [0]
            for (const lineBreak of this.foldedText(key).matchAll(LINE_BREAK)) {
                starts.push(lineBreak.index + lineBreak[0].length)
            }
            this.lineStarts.set(key, starts)
        }
        return starts
    }

    private collectWords(): FileWords {
        const indexes = new Map<string, number>()
        const words: string[] = []
        const lines: number[][] = []
        const starts = this.lineStartsOf("none")
        let line = 0
        for (const match of this.text.matchAll(WORD)) {
            while (line + 1 < starts.length && starts[line + 1]! <= match.index) {
                line++
            }
            const index = indexes.get(match[0])
            if (index === undefined) {
                indexes.set(match[0], words.length)
                words.push(match[0])
                lines.push([line])
            } else if (lines[index]!.at(-1) !== line) {
                lines[index]!.push(line)
            }
        }
        const asciiFile = this.isAscii()
        const ascii = new Uint8Array(words.length)
        const letters = new Int32Array(words.length)
        const folded = words.map((word, index) => {
            const asciiWord = asciiFile || ASCII_ONLY.test(word)
            ascii[index] = asciiWord ? 1 : 0
            const fold = asciiWord ? word.toLowerCase() : foldedString(word, true)
            letters[index] = letterBits(fold)
            return fold
        })
        const foldedLengths = folded.map((fold) => fold.length)
        return { words, folded, foldedLengths, letters, ascii, boundaries: [], lines }
    }
}

/** The line that holds `offset`, searched from line `from` on. `starts` holds the offset where each line starts. */
function lineHoldingOffset(starts: readonly number[], offset: number, from: number): number {
    let low = from
    let high = starts.length - 1
    while (low < high) {
        const middle = (low + high + 1) >> 1
        if (starts[middle]! <= offset) {
            low = middle
        } else {
            high = middle - 1
        }
    }
    return low
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
    /** Per character of `folded`: how often it appears there. */
    characterCounts: Map<string, number>
    /** Per ASCII code unit: how often `folded` holds it. */
    asciiCounts: Int32Array
    /** The bits of `letterBits` for `folded`. */
    letters: number
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
const LINE_BREAK_BEFORE_MARK = /[\r\n]\p{M}/u
const ASCII_ONLY = /^[\x00-\x7f]*$/

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
            const foldedCodePoints = codePoints(folded)
            const maxEdits = matching.fuzzy
                ? allowedEdits(codePointLength(piece.value), matching)
                : 0
            return {
                kind: "word",
                value: piece.value,
                folded,
                foldedCodePoints,
                normalized: normalizeWord(piece.value, matching),
                strict: matching.matchCase || !matching.umlautVariants,
                maxEdits,
                characterCounts: characterCounts(folded),
                asciiCounts: asciiCounts(folded),
                letters: letterBits(folded),
                closeSpellingsByWord: new Map()
            }
        }
        default:
            return never(`unknown text piece ${JSON.stringify(piece)}`)
    }
}

function asciiCounts(text: string): Int32Array {
    const counts = new Int32Array(128)
    for (let index = 0; index < text.length; index++) {
        const unit = text.charCodeAt(index)
        if (unit < 128) {
            counts[unit]!++
        }
    }
    return counts
}

function characterCounts(text: string): Map<string, number> {
    const counts = new Map<string, number>()
    for (const character of text) {
        counts.set(character, (counts.get(character) ?? 0) + 1)
    }
    return counts
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
        private readonly matching: MatchingOptions,
        private readonly file: FileFolds | undefined
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
                const fuzzy = fuzzyOccurrences(
                    this.line,
                    folded,
                    this.lineWords(),
                    piece,
                    found,
                    this.file?.closeSpellingsOf(piece)
                )
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
    foldedFinds: Occurrence[],
    fileSpellings: ReadonlyMap<string, CloseSpelling[]> | undefined
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

        const text = line.slice(word.start, word.end)
        // The words of the file that the map leaves out hold no close spelling.
        const spellings = fileSpellings
            ? (fileSpellings.get(text) ?? NO_SPELLINGS)
            : cachedCloseSpellings(piece, text)
        for (const span of spellings) {
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

/** Holds the code points of the span that `closeSpellings` compares, reused to spare an array per span. */
const spanPoints: number[] = []
/**
 * Per ASCII code unit: how often the span of an ASCII word that `closeSpellings` grows holds it.
 * Every entry returns to 0 before the next span starts.
 */
const spanCounts = new Int32Array(128)

interface CloseSpelling extends Range {
    edits: number
}

/** Shared by every word without a close spelling. A caller must not change it. */
const NO_SPELLINGS: CloseSpelling[] = []

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
    const ascii = ASCII_ONLY.test(word)
    const foldedWord = ascii ? word.toLowerCase() : foldedString(word, true)
    return closeSpellingsOfFolded(piece, word, foldedWord, ascii, partBoundaries(word))
}

/** `closeSpellings` of a word that the caller folded with `foldedString(word, true)`. `ascii` must be true if the word holds ASCII alone. */
function closeSpellingsOfFolded(
    piece: FuzzyWordPiece,
    word: string,
    foldedWord: string,
    ascii: boolean,
    boundaries: readonly number[]
): CloseSpelling[] {
    if (lacksTooManyCharacters(piece, foldedWord)) {
        return NO_SPELLINGS
    }
    // ASCII text folds unit by unit. Its folded offsets equal its own.
    const foldedOffsets = ascii ? undefined : foldText(word, true).foldedOffsets
    const queryLength = piece.foldedCodePoints.length
    // Code points never outnumber code units and take at most two each, so code units bound the length of a span.
    // An ASCII span holds one code point per code unit.
    const minSpanUnits = queryLength - piece.maxEdits
    const maxSpanUnits = ascii ? queryLength + piece.maxEdits : 2 * (queryLength + piece.maxEdits)
    let spellings: CloseSpelling[] | undefined
    for (let from = 0; from < boundaries.length - 1; from++) {
        const spanStart = foldedOffsets?.[boundaries[from]!] ?? boundaries[from]!
        // Counts the characters of an ASCII span as it grows, see `spanCounts`.
        let counted = spanStart
        let shared = 0
        for (let to = from + 1; to < boundaries.length; to++) {
            const spanEnd = foldedOffsets?.[boundaries[to]!] ?? boundaries[to]!
            if (spanEnd - spanStart > maxSpanUnits) {
                break
            }
            if (ascii) {
                for (; counted < spanEnd; counted++) {
                    const unit = foldedWord.charCodeAt(counted)
                    if (spanCounts[unit]! < piece.asciiCounts[unit]!) {
                        shared++
                    }
                    spanCounts[unit]!++
                }
            }
            if (spanEnd - spanStart < minSpanUnits) {
                continue
            }
            // Each edit takes at most one character of the query word away, as in `lacksTooManyCharacters`.
            if (ascii && shared < queryLength - piece.maxEdits) {
                continue
            }
            const length = codePointsInto(spanPoints, foldedWord, spanStart, spanEnd)
            if (Math.abs(length - queryLength) > piece.maxEdits) {
                continue
            }
            const edits = editDistance(piece.foldedCodePoints, spanPoints, piece.maxEdits, length)
            if (edits <= piece.maxEdits) {
                spellings ??= []
                spellings.push({ start: boundaries[from]!, end: boundaries[to]!, edits })
            }
        }
        for (let unit = spanStart; unit < counted; unit++) {
            spanCounts[foldedWord.charCodeAt(unit)] = 0
        }
    }
    if (spellings === undefined) {
        return NO_SPELLINGS
    }
    const fewestEdits = Math.min(...spellings.map((spelling) => spelling.edits))
    return spellings.filter((spelling) => spelling.edits === fewestEdits)
}

/**
 * Returns true if the folded word lacks more characters of the query word than the allowed edits.
 * Such a word holds no close spelling, since each edit takes at most one character of the query word away.
 * A swap of two neighbors takes none.
 */
function lacksTooManyCharacters(piece: FuzzyWordPiece, foldedWord: string): boolean {
    let missing = 0
    for (const [character, needed] of piece.characterCounts) {
        let found = 0
        for (
            let at = foldedWord.indexOf(character);
            at !== -1 && found < needed;
            at = foldedWord.indexOf(character, at + character.length)
        ) {
            found++
        }
        missing += needed - found
        if (missing > piece.maxEdits) {
            return true
        }
    }
    return false
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
