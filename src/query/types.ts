import type { MatchReason, Range } from "../search/types"

/** The parsed form of a key path, following the grammar in DESIGN.md. The query parser owns its shape. */
export interface KeyPathPattern {
    /** The parts between the dots outside groups. Never empty. */
    segments: KeyPathSegment[]
}

/** `**` alone between two dots: zero or more keys. */
export interface GlobstarSegment {
    kind: "globstar"
}

/** Every other segment matches one key, or several keys through a group whose alternative holds dots. */
export type KeyPathSegment = GlobstarSegment | { kind: "key"; pieces: KeyPathPiece[] }

/** A segment inside a group alternative. It holds no group, since groups do not nest. */
export type AltSegment = GlobstarSegment | { kind: "key"; pieces: AltPiece[] }

export type KeyPathPiece = AltPiece | GroupPiece

/** Matches when one of its alternatives matches. Each alternative lists its segments, so it may span several keys. */
export interface GroupPiece {
    kind: "group"
    alternatives: AltSegment[][]
}

export type AltPiece =
    /** Literal characters and escaped characters, merged into one run. They match under the matching defaults. */
    | { kind: "literal"; value: string }
    /** The characters between double quotes, escapes resolved. They match as written. */
    | { kind: "quoted"; value: string }
    /** `*`: zero or more characters inside one key. */
    | { kind: "star" }
    /** `?`: one character. */
    | { kind: "question" }
    | { kind: "class"; negated: boolean; items: ClassItem[] }

/** The characters from `from` to `to`, both included. A single character has `from === to`. */
export interface ClassItem {
    from: string
    to: string
}

export interface QueryError {
    /** One sentence for the hint line, such as "The key path skips this query because a bracket ([) stays open. Close it with ]." */
    message: string
    range: Range
}

/** The result of comparing a pattern literal with a key. `reasons` stays empty when the literal matches as written. */
export interface KeyMatch {
    reasons: MatchReason[]
}

/**
 * Compares a literal of a key path pattern with a key or with a part of a key.
 * Returns undefined when they differ.
 * `exact` marks a quoted literal: it must match as written, without the matching defaults.
 * `fuzzy` allows a match a few edits away.
 * It holds only when the literal makes up a whole segment and `keyText` a whole key.
 * Without `fuzzy`, `keyText` may be any part of a key, such as `grav` of `gravitee` for the pattern `grav*`.
 */
export type CompareKey = (
    literal: string,
    keyText: string,
    how: { exact: boolean; fuzzy: boolean }
) => KeyMatch | undefined

export interface KeyReasons {
    /** Index into the keys passed to the matcher. */
    index: number
    /** Empty when the key matched as written. */
    reasons: MatchReason[]
}

export interface KeyPathMatch {
    /** Index of the first matched key. 0 for `matchKeyPath`. */
    start: number
    /** Index after the last matched key. */
    end: number
    /** One entry per matched key from `start` to `end`, in order. */
    keys: KeyReasons[]
}

export interface HighlightSpan {
    /** "operator" takes the highlight color, "escape" dims, "text" keeps the text color. */
    kind: "operator" | "escape" | "text"
    range: Range
}

export interface Hint {
    text: string
    /** "highlight" marks a hint that confirms what the query does. */
    tone: "info" | "highlight"
    /** The query that a click on the hint runs. */
    suggestedQuery?: string
}
