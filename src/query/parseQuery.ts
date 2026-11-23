import type { MatchingOptions, Query, TextPiece } from "../search/types"
import { parseKeyPath } from "./keyPathParser"

const WORD_CHAR = /^[\p{L}\p{M}\p{N}]$/u

/**
 * Parses the text of the query input.
 * A query between two slashes turns into a regex query.
 * Every other query turns into a text query with its pieces and, where the key path grammar allows, its key path.
 * A text query carries `matching` when the caller passes it.
 */
export function parseQuery(raw: string, matching?: MatchingOptions): Query {
    if (isRegexQuery(raw)) {
        return { kind: "regex", raw, source: raw.slice(1, -1) }
    }
    const parsed = parseKeyPath(raw)
    const pieces = parseTextPieces(raw)
    const query: Query =
        "error" in parsed
            ? { kind: "text", raw, pieces, keyPathError: parsed.error }
            : { kind: "text", raw, pieces, keyPath: parsed.pattern }
    if (matching) query.matching = matching
    return query
}

/** True when the query starts with a slash and ends with a second, unescaped one. */
export function isRegexQuery(raw: string): boolean {
    if (raw.length < 2 || !raw.startsWith("/") || !raw.endsWith("/")) {
        return false
    }
    let backslashes = 0
    for (let i = raw.length - 2; i > 0 && raw[i] === "\\"; i--) {
        backslashes++
    }
    return backslashes % 2 === 0
}

/**
 * Writes `text` as a query whose `\`, `*` and `"` match themselves.
 * A slash that would start a regex query gets a backslash as well.
 */
export function literalQuery(text: string): string {
    const escaped = text.replace(/[\\*"]/g, (char) => `\\${char}`)
    return isRegexQuery(escaped) ? `\\${escaped}` : escaped
}

/**
 * Splits a text query into words, literals and wildcards.
 * A backslash makes the next character literal.
 * Double quotes make their words exact and their `*` literal.
 * A quote left open quotes the rest of the query.
 */
export function parseTextPieces(raw: string): TextPiece[] {
    const pieces = new TextPieceBuilder()
    const chars = Array.from(raw)
    let quoted = false
    for (let i = 0; i < chars.length; i++) {
        const char = chars[i]!
        if (char === "\\") {
            const escaped = chars[i + 1]
            pieces.addLiteral(escaped ?? char)
            i++
            continue
        }
        if (char === '"') {
            quoted = !quoted
            pieces.breakWord()
            continue
        }
        if (char === "*" && !quoted) {
            pieces.addWildcard()
            continue
        }
        if (WORD_CHAR.test(char)) {
            pieces.addWordChar(char, quoted)
            continue
        }
        pieces.addLiteral(char)
    }
    return pieces.pieces
}

class TextPieceBuilder {
    readonly pieces: TextPiece[] = []
    private wordOpen = false

    addWordChar(char: string, exact: boolean): void {
        const last = this.pieces[this.pieces.length - 1]
        if (this.wordOpen && last?.kind === "word" && last.exact === exact) {
            last.value += char
            return
        }
        this.pieces.push({ kind: "word", value: char, exact })
        this.wordOpen = true
    }

    addLiteral(text: string): void {
        this.wordOpen = false
        const last = this.pieces[this.pieces.length - 1]
        if (last?.kind === "literal") {
            last.value += text
            return
        }
        this.pieces.push({ kind: "literal", value: text })
    }

    addWildcard(): void {
        this.wordOpen = false
        if (this.pieces[this.pieces.length - 1]?.kind === "wildcard") {
            return
        }
        this.pieces.push({ kind: "wildcard" })
    }

    /** Keeps the next word character from joining the word before a quote. */
    breakWord(): void {
        this.wordOpen = false
    }
}
