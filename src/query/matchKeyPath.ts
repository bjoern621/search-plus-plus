import type { MatchReason } from "../search/types"
import { assert, assertNever } from "./assert"
import type {
    AltPiece,
    AltSegment,
    ClassItem,
    CompareKey,
    KeyPathMatch,
    KeyPathPattern,
    KeyReasons
} from "./types"

/**
 * The pattern flattened into one stream.
 * A separator stands for a dot between segments.
 * A whole key stands for a segment made of literals alone, the one place where fuzzy matching applies.
 */
type Token =
    | { kind: "piece"; piece: AltPiece }
    | { kind: "wholeKey"; value: string }
    | { kind: "group"; alternatives: Token[][] }
    | { kind: "separator" }
    | { kind: "globstar" }

interface FoundReason {
    index: number
    reason: MatchReason
}

interface Context {
    keys: readonly string[]
    /** Per key, the UTF-16 offsets at which a code point starts, plus the key length. */
    boundaries: number[][]
    compareKey: CompareKey
    /** Per token stream, the states "ti:ki:ci" from which no match exists. */
    deadEnds: WeakMap<Token[], Set<string>>
    /** Per token stream and group index, the stream with each alternative spliced in. */
    splices: WeakMap<Token[], Map<number, Map<Token[], Token[]>>>
}

/**
 * Matches the whole pattern against the whole key path of a node.
 * Sequence items take their index as key, such as "0".
 * Literals go through `compareKey`, which applies the matching defaults.
 * Returns undefined when the pattern does not match or `keys` is empty.
 * Of several ways to match, it returns the one with the fewest reasons.
 */
export function matchKeyPath(
    pattern: KeyPathPattern,
    keys: readonly string[],
    compareKey: CompareKey
): KeyPathMatch | undefined {
    if (keys.length === 0) {
        return undefined
    }
    const fixedCount = fixedKeyCount(pattern)
    if (fixedCount !== undefined && fixedCount !== keys.length) {
        return undefined
    }
    const context: Context = {
        keys,
        boundaries: keys.map(codePointBoundaries),
        compareKey,
        deadEnds: new WeakMap(),
        splices: new WeakMap()
    }
    const found = fewestReasons(matchFrom(context, patternTokens(pattern), 0, 0, 0))
    if (found === undefined) {
        return undefined
    }
    return { start: 0, end: keys.length, keys: reasonsPerKey(found, 0, keys.length) }
}

/**
 * Matches the pattern against any run of neighbouring keys, such as a member access chain in code.
 * `config.server.port` finds the keys of `this.config.server.port` from index 1.
 * Returns the run with the fewest reasons, the leftmost and then the longest of those.
 * Returns undefined when no run matches.
 */
export function findInChain(
    pattern: KeyPathPattern,
    keys: string[],
    compareKey: CompareKey
): KeyPathMatch | undefined {
    let best: KeyPathMatch | undefined
    let bestReasonCount = Infinity
    for (let start = 0; start < keys.length; start++) {
        for (let end = keys.length; end > start; end--) {
            const match = matchKeyPath(pattern, keys.slice(start, end), compareKey)
            if (match === undefined) {
                continue
            }
            const reasonCount = countReasons(match)
            if (reasonCount < bestReasonCount) {
                best = shiftMatch(match, start)
                bestReasonCount = reasonCount
            }
            if (reasonCount === 0) {
                return best
            }
        }
    }
    return best
}

/** The number of keys that the pattern matches, or undefined when globstars or groups let it vary. */
function fixedKeyCount(pattern: KeyPathPattern): number | undefined {
    for (const segment of pattern.segments) {
        if (segment.kind === "globstar" || segment.pieces.some((piece) => piece.kind === "group")) {
            return undefined
        }
    }
    return pattern.segments.length
}

function patternTokens(pattern: KeyPathPattern): Token[] {
    const tokens: Token[] = []
    pattern.segments.forEach((segment, i) => {
        if (segment.kind === "globstar" && pattern.segments[i - 1]?.kind === "globstar") {
            return
        }
        if (i > 0) {
            tokens.push({ kind: "separator" })
        }
        if (segment.kind === "globstar") {
            tokens.push({ kind: "globstar" })
            return
        }
        const only = segment.pieces[0]
        if (segment.pieces.length === 1 && only?.kind === "literal") {
            tokens.push({ kind: "wholeKey", value: only.value })
            return
        }
        for (const piece of segment.pieces) {
            if (piece.kind === "group") {
                tokens.push({
                    kind: "group",
                    alternatives: piece.alternatives.map(alternativeTokens)
                })
            } else {
                tokens.push({ kind: "piece", piece })
            }
        }
    })
    return tokens
}

/** Tokens of a group alternative. Its literals match without fuzziness, since a group never makes up a segment of literals alone. */
function alternativeTokens(segments: AltSegment[]): Token[] {
    const tokens: Token[] = []
    segments.forEach((segment, i) => {
        if (i > 0) {
            tokens.push({ kind: "separator" })
        }
        if (segment.kind === "globstar") {
            tokens.push({ kind: "globstar" })
            return
        }
        for (const piece of segment.pieces) {
            tokens.push({ kind: "piece", piece })
        }
    })
    return tokens
}

/**
 * Yields the reasons of every way in which `tokens` from `ti` match the keys from offset `ci` of key `ki` to the end.
 * A state between two keys sits at the end of the earlier key.
 * A state that yields nothing gets remembered, so a failing pattern with several stars tries each state once.
 */
function* matchFrom(
    context: Context,
    tokens: Token[],
    ti: number,
    ki: number,
    ci: number
): Generator<FoundReason[]> {
    let deadEnds = context.deadEnds.get(tokens)
    const state = `${ti}:${ki}:${ci}`
    if (deadEnds?.has(state)) {
        return
    }
    let yielded = false
    for (const found of matchState(context, tokens, ti, ki, ci)) {
        yielded = true
        yield found
    }
    if (!yielded) {
        if (deadEnds === undefined) {
            deadEnds = new Set()
            context.deadEnds.set(tokens, deadEnds)
        }
        deadEnds.add(state)
    }
}

function* matchState(
    context: Context,
    tokens: Token[],
    ti: number,
    ki: number,
    ci: number
): Generator<FoundReason[]> {
    const key = context.keys[ki]
    assert(key !== undefined, "the matcher stays inside the key path")
    const token = tokens[ti]
    if (token === undefined) {
        if (ki === context.keys.length - 1 && ci === key.length) {
            yield []
        }
        return
    }
    switch (token.kind) {
        case "group":
            for (const alternative of token.alternatives) {
                yield* matchFrom(context, splice(context, tokens, ti, alternative), ti, ki, ci)
            }
            return
        case "separator":
            yield* matchSeparator(context, tokens, ti, ki, ci)
            return
        case "globstar":
            yield* matchGlobstar(context, tokens, ti, ki, ci)
            return
        case "wholeKey": {
            assert(ci === 0, "a whole-key token starts at the start of a key")
            const match = context.compareKey(token.value, key, { exact: false, fuzzy: true })
            if (match !== undefined) {
                yield* withReasons(
                    ki,
                    match.reasons,
                    matchFrom(context, tokens, ti + 1, ki, key.length)
                )
            }
            return
        }
        case "piece":
            yield* matchPiece(context, tokens, ti, token.piece, ki, ci)
            return
        default:
            assertNever(token)
    }
}

function* matchSeparator(
    context: Context,
    tokens: Token[],
    ti: number,
    ki: number,
    ci: number
): Generator<FoundReason[]> {
    const next = tokens[ti + 1]
    if (next?.kind === "group") {
        // The separator needs to see whether a globstar follows it.
        for (const alternative of next.alternatives) {
            yield* matchFrom(context, splice(context, tokens, ti + 1, alternative), ti, ki, ci)
        }
        return
    }
    if (ci !== context.keys[ki]!.length) {
        return
    }
    if (next?.kind === "globstar" && tokens[ti + 2] === undefined) {
        // A trailing `.**` matches the key before it and every key below.
        yield []
        return
    }
    if (ki + 1 < context.keys.length) {
        yield* matchFrom(context, tokens, ti + 1, ki + 1, 0)
    }
}

/**
 * A globstar between separators skips zero or more whole keys.
 * A globstar that a group glues to the characters of a key acts as `*`.
 */
function* matchGlobstar(
    context: Context,
    tokens: Token[],
    ti: number,
    ki: number,
    ci: number
): Generator<FoundReason[]> {
    const before = tokens[ti - 1]
    const after = tokens[ti + 1]
    const startsKey = ci === 0 && (before === undefined || before.kind === "separator")
    const endsKey = after === undefined || after.kind === "separator"
    if (!startsKey || !endsKey) {
        yield* matchStar(context, tokens, ti, ki, ci)
        return
    }
    if (after === undefined) {
        yield []
        return
    }
    for (let next = ki; next < context.keys.length; next++) {
        yield* matchFrom(context, tokens, ti + 2, next, 0)
    }
}

function* matchPiece(
    context: Context,
    tokens: Token[],
    ti: number,
    piece: AltPiece,
    ki: number,
    ci: number
): Generator<FoundReason[]> {
    const key = context.keys[ki]!
    const boundaries = context.boundaries[ki]!
    switch (piece.kind) {
        case "literal":
        case "quoted": {
            if (piece.value === "") {
                yield* matchFrom(context, tokens, ti + 1, ki, ci)
                return
            }
            const how = { exact: piece.kind === "quoted", fuzzy: false }
            for (const end of boundaries) {
                if (end <= ci) {
                    continue
                }
                const match = context.compareKey(piece.value, key.slice(ci, end), how)
                if (match !== undefined) {
                    yield* withReasons(
                        ki,
                        match.reasons,
                        matchFrom(context, tokens, ti + 1, ki, end)
                    )
                }
            }
            return
        }
        case "star":
            yield* matchStar(context, tokens, ti, ki, ci)
            return
        case "question":
        case "class": {
            const codePoint = key.codePointAt(ci)
            if (codePoint === undefined) {
                return
            }
            const char = String.fromCodePoint(codePoint)
            if (piece.kind === "class" && classHolds(piece.items, char) === piece.negated) {
                return
            }
            yield* matchFrom(context, tokens, ti + 1, ki, ci + char.length)
            return
        }
        default:
            assertNever(piece)
    }
}

function* matchStar(
    context: Context,
    tokens: Token[],
    ti: number,
    ki: number,
    ci: number
): Generator<FoundReason[]> {
    for (const end of context.boundaries[ki]!) {
        if (end >= ci) {
            yield* matchFrom(context, tokens, ti + 1, ki, end)
        }
    }
}

/** Classes ignore case: a character matches when it or its lower or upper case form falls into an item. */
function classHolds(items: ClassItem[], char: string): boolean {
    const variants = [char, char.toLowerCase(), char.toUpperCase()]
    return items.some((item) =>
        variants.some((variant) => {
            const codePoint = variant.codePointAt(0)!
            return (
                Array.from(variant).length === 1 &&
                codePoint >= item.from.codePointAt(0)! &&
                codePoint <= item.to.codePointAt(0)!
            )
        })
    )
}

function* withReasons(
    index: number,
    reasons: MatchReason[],
    rest: Generator<FoundReason[]>
): Generator<FoundReason[]> {
    const own = reasons.map((reason) => ({ index, reason }))
    for (const found of rest) {
        yield [...own, ...found]
    }
}

/**
 * Replaces the token at `ti` with the tokens of a group alternative.
 * Returns the same array for the same input, so that the dead ends recorded for it apply on every visit.
 */
function splice(context: Context, tokens: Token[], ti: number, alternative: Token[]): Token[] {
    let byAlternative = context.splices.get(tokens)?.get(ti)
    if (byAlternative === undefined) {
        byAlternative = new Map()
        const byIndex = context.splices.get(tokens) ?? new Map<number, Map<Token[], Token[]>>()
        byIndex.set(ti, byAlternative)
        context.splices.set(tokens, byIndex)
    }
    let spliced = byAlternative.get(alternative)
    if (spliced === undefined) {
        spliced = [...tokens.slice(0, ti), ...alternative, ...tokens.slice(ti + 1)]
        byAlternative.set(alternative, spliced)
    }
    return spliced
}

/** Stops at the first match without reasons. */
function fewestReasons(matches: Generator<FoundReason[]>): FoundReason[] | undefined {
    let best: FoundReason[] | undefined
    for (const found of matches) {
        if (found.length === 0) {
            return found
        }
        if (best === undefined || found.length < best.length) {
            best = found
        }
    }
    return best
}

function reasonsPerKey(found: FoundReason[], start: number, end: number): KeyReasons[] {
    const keys: KeyReasons[] = []
    for (let index = start; index < end; index++) {
        keys.push({
            index,
            reasons: found.filter((entry) => entry.index === index).map((entry) => entry.reason)
        })
    }
    return keys
}

function countReasons(match: KeyPathMatch): number {
    return match.keys.reduce((sum, key) => sum + key.reasons.length, 0)
}

function shiftMatch(match: KeyPathMatch, offset: number): KeyPathMatch {
    return {
        start: match.start + offset,
        end: match.end + offset,
        keys: match.keys.map((key) => ({ index: key.index + offset, reasons: key.reasons }))
    }
}

function codePointBoundaries(key: string): number[] {
    const boundaries: number[] = []
    let offset = 0
    for (const char of key) {
        boundaries.push(offset)
        offset += char.length
    }
    boundaries.push(offset)
    return boundaries
}
