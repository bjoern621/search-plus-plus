/** One key of a member access chain, with its file offsets. A bracket access `["a"]` spans the string, quotes included. */
export interface ChainKey {
    name: string
    start: number
    end: number
}

/** Reads a chain such as `this.config?.server["port"]` as the keys `this`, `config`, `server`, `port`. */
export type MemberChain = ChainKey[]

type Token =
    | { kind: "name"; value: string; start: number; end: number }
    | { kind: "string"; value: string; start: number; end: number }
    | { kind: "number"; value: string; start: number; end: number }
    | { kind: "punctuation"; value: string; start: number; end: number }

/** Keywords after which a `/` starts a regex literal, the same as after an operator. */
const KEYWORDS_BEFORE_EXPRESSION = new Set([
    "return",
    "typeof",
    "instanceof",
    "in",
    "of",
    "new",
    "delete",
    "void",
    "throw",
    "case",
    "do",
    "else",
    "yield",
    "await"
])

/**
 * Lists the member access chains of a JavaScript or TypeScript text.
 * A chain joins names with `.`, `?.`, the non-null `!` of TypeScript and brackets around a string or an integer.
 * Whitespace and comments may sit between its parts, so a chain may span several lines.
 * A call, a computed access such as `a[i]` and every other token end a chain.
 * The names after the end start a new chain: `load().server.port` holds the chain `server.port`.
 * Strings, comments, regex literals and the text of template literals hold no chains.
 * The code inside `${ }` of a template literal does.
 * Only chains of two keys or more come back.
 */
export function memberChains(text: string): MemberChain[] {
    const tokens = new Tokenizer(text).tokens()
    const chains: MemberChain[] = []
    let i = 0
    while (i < tokens.length) {
        const token = tokens[i]!
        i++
        if (token.kind !== "name") {
            continue
        }
        const chain: MemberChain = [{ name: token.value, start: token.start, end: token.end }]
        for (let access = accessAt(tokens, i); access !== undefined; access = accessAt(tokens, i)) {
            chain.push(access.key)
            i = access.after
        }
        if (chain.length >= 2) {
            chains.push(chain)
        }
    }
    return chains
}

/** The key that the access starting at token `i` adds to a chain, and the index after the access. */
function accessAt(tokens: Token[], i: number): { key: ChainKey; after: number } | undefined {
    let at = i
    if (
        punctuationAt(tokens, at) === "!" &&
        [".", "?.", "["].includes(punctuationAt(tokens, at + 1) ?? "")
    ) {
        at++
    }
    const operator = punctuationAt(tokens, at)
    if (operator === "." || operator === "?.") {
        const name = tokens[at + 1]
        if (name?.kind === "name") {
            return { key: { name: name.value, start: name.start, end: name.end }, after: at + 2 }
        }
        if (operator === "?." && punctuationAt(tokens, at + 1) === "[") {
            return bracketAccessAt(tokens, at + 1)
        }
        return undefined
    }
    if (operator === "[") {
        return bracketAccessAt(tokens, at)
    }
    return undefined
}

function bracketAccessAt(
    tokens: Token[],
    open: number
): { key: ChainKey; after: number } | undefined {
    const inner = tokens[open + 1]
    if (punctuationAt(tokens, open + 2) !== "]" || inner === undefined) {
        return undefined
    }
    if (inner.kind === "string" || (inner.kind === "number" && /^\d+$/.test(inner.value))) {
        return { key: { name: inner.value, start: inner.start, end: inner.end }, after: open + 3 }
    }
    return undefined
}

function punctuationAt(tokens: Token[], i: number): string | undefined {
    const token = tokens[i]
    return token?.kind === "punctuation" ? token.value : undefined
}

/**
 * Splits JavaScript and TypeScript into names, strings, numbers and punctuation.
 * It drops whitespace, comments, regex literals and the text of template literals.
 * A quoted string ends at its line break, so an unclosed quote, such as an apostrophe in JSX text, hides one line at most.
 */
class Tokenizer {
    private offset = 0
    private readonly output: Token[] = []
    /** Per open `${` of a template literal, the count of `{` opened inside it and not yet closed. */
    private readonly templateBraces: number[] = []

    constructor(private readonly text: string) {}

    tokens(): Token[] {
        const text = this.text
        if (text.startsWith("#!")) {
            this.offset = lineEndAfter(text, 0)
        }
        while (this.offset < text.length) {
            const char = text[this.offset]!
            const code = text.charCodeAt(this.offset)
            if (isWhitespace(code)) {
                this.offset++
            } else if (char === "/" && text[this.offset + 1] === "/") {
                this.offset = lineEndAfter(text, this.offset)
            } else if (char === "/" && text[this.offset + 1] === "*") {
                const close = text.indexOf("*/", this.offset + 2)
                this.offset = close === -1 ? text.length : close + 2
            } else if (char === "/" && this.regexAllowed()) {
                this.skipRegex()
            } else if (char === '"' || char === "'") {
                this.readQuoted(char)
            } else if (char === "`") {
                this.offset++
                this.skipTemplateText()
            } else if (isNameStart(code)) {
                this.readName()
            } else if (
                isDigit(code) ||
                (char === "." && isDigit(text.charCodeAt(this.offset + 1)))
            ) {
                this.readNumber()
            } else {
                this.readPunctuation(char)
            }
        }
        return this.output
    }

    private regexAllowed(): boolean {
        const previous = this.output.at(-1)
        if (previous === undefined) {
            return true
        }
        if (previous.kind === "name") {
            return KEYWORDS_BEFORE_EXPRESSION.has(previous.value)
        }
        if (previous.kind === "punctuation") {
            return previous.value !== ")" && previous.value !== "]" && previous.value !== "}"
        }
        return false
    }

    /** Skips a regex literal and its flags. A literal that meets a line break before its closing `/` ends there. */
    private skipRegex(): void {
        const text = this.text
        let at = this.offset + 1
        let inClass = false
        while (at < text.length && text[at] !== "\n") {
            const char = text[at]
            if (char === "\\") {
                at += 2
                continue
            }
            if (char === "[") {
                inClass = true
            } else if (char === "]") {
                inClass = false
            } else if (char === "/" && !inClass) {
                at++
                break
            }
            at++
        }
        while (at < text.length && isNamePart(text.charCodeAt(at))) {
            at++
        }
        this.offset = at
    }

    private readQuoted(quote: string): void {
        const text = this.text
        const start = this.offset
        let value = ""
        let at = start + 1
        while (at < text.length && text[at] !== quote && text[at] !== "\n") {
            if (text[at] === "\\") {
                value += text[at + 1] ?? ""
                at += 2
                continue
            }
            value += text[at]
            at++
        }
        const closed = text[at] === quote
        this.offset = closed ? at + 1 : at
        this.output.push({ kind: "string", value, start, end: this.offset })
    }

    /** Skips template literal text up to its closing backtick or to a `${`, which opens code. */
    private skipTemplateText(): void {
        const text = this.text
        let at = this.offset
        while (at < text.length) {
            const char = text[at]
            if (char === "\\") {
                at += 2
                continue
            }
            if (char === "`") {
                this.offset = at + 1
                this.output.push({ kind: "punctuation", value: "`", start: at, end: at + 1 })
                return
            }
            if (char === "$" && text[at + 1] === "{") {
                this.offset = at + 2
                this.templateBraces.push(0)
                this.output.push({ kind: "punctuation", value: "${", start: at, end: at + 2 })
                return
            }
            at++
        }
        this.offset = text.length
    }

    private readName(): void {
        const text = this.text
        const start = this.offset
        let at = start + 1
        while (at < text.length && isNamePart(text.charCodeAt(at))) {
            at++
        }
        this.offset = at
        this.output.push({ kind: "name", value: text.slice(start, at), start, end: at })
    }

    private readNumber(): void {
        const text = this.text
        const start = this.offset
        let at = start
        while (at < text.length && (isNamePart(text.charCodeAt(at)) || text[at] === ".")) {
            at++
        }
        this.offset = at
        this.output.push({ kind: "number", value: text.slice(start, at), start, end: at })
    }

    private readPunctuation(char: string): void {
        const start = this.offset
        if (
            char === "?" &&
            this.text[start + 1] === "." &&
            !isDigit(this.text.charCodeAt(start + 2))
        ) {
            this.offset += 2
            this.output.push({ kind: "punctuation", value: "?.", start, end: start + 2 })
            return
        }
        this.offset++
        const open = this.templateBraces.length - 1
        if (char === "{" && open >= 0) {
            this.templateBraces[open]!++
        } else if (char === "}" && open >= 0) {
            if (this.templateBraces[open] === 0) {
                this.templateBraces.pop()
                this.output.push({ kind: "punctuation", value: "}", start, end: start + 1 })
                this.skipTemplateText()
                return
            }
            this.templateBraces[open]!--
        }
        this.output.push({ kind: "punctuation", value: char, start, end: start + 1 })
    }
}

function lineEndAfter(text: string, offset: number): number {
    const end = text.indexOf("\n", offset)
    return end === -1 ? text.length : end
}

function isWhitespace(code: number): boolean {
    return (
        code === 0x20 ||
        code === 0x09 ||
        code === 0x0a ||
        code === 0x0d ||
        code === 0x0b ||
        code === 0x0c ||
        code === 0xa0 ||
        code === 0xfeff ||
        (code >= 0x2000 && code <= 0x200b) ||
        code === 0x2028 ||
        code === 0x2029
    )
}

function isDigit(code: number): boolean {
    return code >= 0x30 && code <= 0x39
}

const NAME_START = /[\p{ID_Start}$_#]/u
const NAME_PART = /[\p{ID_Continue}$‌‍]/u

function isNameStart(code: number): boolean {
    if (code < 0x80) {
        return (
            (code >= 0x61 && code <= 0x7a) ||
            (code >= 0x41 && code <= 0x5a) ||
            code === 0x24 ||
            code === 0x5f ||
            code === 0x23
        )
    }
    return NAME_START.test(String.fromCharCode(code))
}

function isNamePart(code: number): boolean {
    if (code < 0x80) {
        return (
            (code >= 0x61 && code <= 0x7a) ||
            (code >= 0x41 && code <= 0x5a) ||
            isDigit(code) ||
            code === 0x24 ||
            code === 0x5f
        )
    }
    return NAME_PART.test(String.fromCharCode(code))
}
