/**
 * Reads the key structure of YAML: block and flow collections, anchors, aliases and documents.
 * Scalar values, tags and complex keys (`? `) stay unread, since key paths need none of them.
 * The reader never throws.
 * A line that fits no structure gets skipped, so a broken part loses its keys and the rest of the document keeps them.
 * It replaces a full YAML parser, which takes most of a second on a 1 MB file.
 */

import { codePointEscape } from "./codePointEscape"

export type YamlNode =
    | { kind: "map"; entries: YamlEntry[] }
    | { kind: "seq"; items: YamlItem[] }
    | { kind: "scalar" }
    | { kind: "alias"; name: string }

export interface YamlEntry {
    key: string
    /** File offsets of the key as written, quotes included. */
    start: number
    end: number
    /** A plain `<<` key, which merges the maps of its value into the map that holds it. */
    isMerge: boolean
    /** Undefined for an empty value. */
    value: YamlNode | undefined
}

export interface YamlItem {
    /** File offsets of the item text on its first line. An empty first line gives the range of the `-`. */
    start: number
    end: number
    value: YamlNode | undefined
}

export interface YamlDocument {
    root: YamlNode | undefined
    /** Maps an anchor name to the node that it names last in the document. */
    anchors: Map<string, YamlNode>
}

interface ImplicitKey {
    text: string
    start: number
    end: number
    /** The offset right after the `:`. */
    afterColon: number
}

const SCALAR: YamlNode = { kind: "scalar" }
const FLOW_INDICATORS = ",[]{}"
/** Characters that cannot start a plain key. `-`, `?` and `:` can, unless a blank follows them. */
const NOT_PLAIN_START = "[]{},#&*!|>%@`\"'"
const MERGE_KEY = "<<"

export function readYamlDocuments(text: string): YamlDocument[] {
    return new YamlReader(text).documents()
}

class YamlReader {
    /** The next offset to read. A block node leaves it at the start of the line after its last line. */
    private pos = 0
    private anchors = new Map<string, YamlNode>()

    constructor(private readonly text: string) {}

    documents(): YamlDocument[] {
        const documents: YamlDocument[] = []
        for (;;) {
            this.skipDirectives()
            const start = this.peekContent()
            if (start >= this.text.length) {
                return documents
            }
            this.anchors = new Map()
            if (this.isDocumentMarker(start, "...")) {
                this.pos = this.nextLineStart(start)
                continue
            }
            const root = this.isDocumentMarker(start, "---")
                ? this.rootAfterMarker(start + 3)
                : this.blockNode(-1, false)
            documents.push({ root, anchors: this.anchors })
            this.skipToNextDocument()
        }
    }

    /** The root of a document whose `---` line may hold a node, such as `--- |` or `--- [a, b]`. */
    private rootAfterMarker(afterMarker: number): YamlNode | undefined {
        const { anchor, after } = this.readProperties(this.skipBlanks(afterMarker))
        if (this.isLineEnd(after)) {
            this.pos = this.nextLineStart(after)
            return this.anchored(anchor, this.blockNode(-1, false))
        }
        return this.anchored(anchor, this.inlineValue(after, -1))
    }

    /**
     * Reads the node on the next content line, if that line sits deeper than `parentIndent`.
     * A sequence may sit at the indent of its parent key when `sequenceAtParentIndent` holds, as YAML allows for map values.
     */
    private blockNode(parentIndent: number, sequenceAtParentIndent: boolean): YamlNode | undefined {
        const start = this.peekContent()
        if (start >= this.text.length || this.isAnyDocumentMarker(start)) {
            return undefined
        }
        const column = this.columnOf(start)
        const isSequence = this.isSequenceEntry(start)
        if (
            column < parentIndent ||
            (column === parentIndent && !(sequenceAtParentIndent && isSequence))
        ) {
            return undefined
        }
        const { anchor, after } = this.readProperties(start)
        if (after !== start && this.isLineEnd(after)) {
            // Properties alone on a line, such as `&defaults`, belong to the node below them.
            this.pos = this.nextLineStart(after)
            return this.anchored(anchor, this.blockNode(parentIndent, sequenceAtParentIndent))
        }
        if (isSequence) {
            return this.anchored(anchor, this.sequence(start, column))
        }
        if (this.implicitKeyAt(after) !== undefined) {
            return this.anchored(anchor, this.map(after, column))
        }
        return this.anchored(anchor, this.inlineValue(after, parentIndent))
    }

    /** Reads a block map whose keys sit at `column`, the first one at `start`. */
    private map(start: number, column: number): YamlNode {
        const entries: YamlEntry[] = []
        let at = start
        for (;;) {
            const key = this.implicitKeyAt(at)
            if (key === undefined) {
                this.pos = this.nextLineStart(at)
            } else {
                const value = this.entryValue(key.afterColon, column)
                entries.push({
                    key: key.text,
                    start: key.start,
                    end: key.end,
                    isMerge: this.isMergeKey(key),
                    value
                })
            }
            const next = this.nextLineAt(column)
            if (next === undefined) {
                return { kind: "map", entries }
            }
            at = next
        }
    }

    /** Reads a block sequence whose dashes sit at `column`, the first one at `start`. */
    private sequence(start: number, column: number): YamlNode {
        const items: YamlItem[] = []
        let dash = start
        for (;;) {
            items.push(this.sequenceItem(dash, column))
            const next = this.nextLineAt(column)
            if (next === undefined || !this.isSequenceEntry(next)) {
                return { kind: "seq", items }
            }
            dash = next
        }
    }

    private sequenceItem(dash: number, column: number): YamlItem {
        const content = this.skipBlanks(dash + 1)
        if (this.isLineEnd(content)) {
            this.pos = this.nextLineStart(content)
            return { start: dash, end: dash + 1, value: this.blockNode(column, false) }
        }
        const end = this.contentEnd(content)
        const { anchor, after } = this.readProperties(content)
        if (this.isLineEnd(after)) {
            this.pos = this.nextLineStart(after)
            return {
                start: content,
                end,
                value: this.anchored(anchor, this.blockNode(column, false))
            }
        }
        if (this.isSequenceEntry(after)) {
            return {
                start: content,
                end,
                value: this.anchored(anchor, this.sequence(after, this.columnOf(after)))
            }
        }
        if (this.implicitKeyAt(after) !== undefined) {
            return {
                start: content,
                end,
                value: this.anchored(anchor, this.map(after, this.columnOf(after)))
            }
        }
        return {
            start: content,
            end,
            value: this.anchored(anchor, this.inlineValue(after, column))
        }
    }

    /** Reads the value after the `:` of a key at `column`, on the same line or on the lines below. */
    private entryValue(afterColon: number, column: number): YamlNode | undefined {
        const { anchor, after } = this.readProperties(this.skipBlanks(afterColon))
        if (this.isLineEnd(after)) {
            this.pos = this.nextLineStart(after)
            return this.anchored(anchor, this.blockNode(column, true))
        }
        return this.anchored(anchor, this.inlineValue(after, column))
    }

    /**
     * Reads a value that starts on the current line: a flow collection, an alias, a quoted, a plain or a block scalar.
     * The lines below that sit deeper than `indent` belong to it, as the content of a block scalar or the rest of a plain one.
     */
    private inlineValue(start: number, indent: number): YamlNode {
        const char = this.text[start]
        if (char === "[" || char === "{") {
            const { node, end } = this.flowNode(start)
            this.pos = this.nextLineStart(end)
            return node
        }
        if (char === "*") {
            const name = this.text.slice(start + 1, this.anchorNameEnd(start + 1))
            this.pos = this.nextLineStart(start)
            return { kind: "alias", name }
        }
        const end = char === '"' || char === "'" ? this.quotedEnd(start) : start
        this.pos = this.nextLineStart(end)
        this.skipLinesDeeperThan(indent)
        return SCALAR
    }

    /** Reads a flow collection or a flow scalar at `start`, across lines. An unclosed collection ends at the end of the text. */
    private flowNode(start: number): { node: YamlNode; end: number; key?: string } {
        const { anchor, after } = this.readProperties(this.skipFlowBlanks(start))
        const char = this.text[after]
        if (char === "[") {
            const { node, end } = this.flowSequence(after)
            return { node: this.anchored(anchor, node)!, end }
        }
        if (char === "{") {
            const { node, end } = this.flowMap(after)
            return { node: this.anchored(anchor, node)!, end }
        }
        if (char === "*") {
            const end = this.anchorNameEnd(after + 1)
            return { node: { kind: "alias", name: this.text.slice(after + 1, end) }, end }
        }
        if (char === '"' || char === "'") {
            const end = this.quotedEnd(after)
            return {
                node: this.anchored(anchor, SCALAR)!,
                end,
                key: unquote(this.text.slice(after, end))
            }
        }
        const end = this.flowPlainEnd(after)
        return {
            node: this.anchored(anchor, SCALAR)!,
            end,
            key: this.text.slice(after, end).trimEnd()
        }
    }

    private flowSequence(open: number): { node: YamlNode; end: number } {
        const items: YamlItem[] = []
        let at = open + 1
        for (;;) {
            at = this.skipFlowBlanks(at)
            const char = this.text[at]
            if (char === undefined) {
                return { node: { kind: "seq", items }, end: at }
            }
            if (char === "]") {
                return { node: { kind: "seq", items }, end: at + 1 }
            }
            if (char === "," || char === "}") {
                at++
                continue
            }
            const item = this.flowNode(at)
            const afterItem = this.skipFlowBlanks(item.end)
            if (this.text[afterItem] === ":" && item.key !== undefined) {
                // A single pair such as `[name: web]` makes a map item.
                const value = this.flowValue(afterItem + 1)
                const entry: YamlEntry = {
                    key: item.key,
                    start: at,
                    end: item.end,
                    isMerge: false,
                    value: value.node
                }
                items.push({ start: at, end: value.end, value: { kind: "map", entries: [entry] } })
                at = value.end
                continue
            }
            items.push({ start: at, end: item.end, value: item.node })
            at = item.end === at ? at + 1 : item.end
        }
    }

    private flowMap(open: number): { node: YamlNode; end: number } {
        const entries: YamlEntry[] = []
        let at = open + 1
        for (;;) {
            at = this.skipFlowBlanks(at)
            const char = this.text[at]
            if (char === undefined) {
                return { node: { kind: "map", entries }, end: at }
            }
            if (char === "}") {
                return { node: { kind: "map", entries }, end: at + 1 }
            }
            if (char === "," || char === "]") {
                at++
                continue
            }
            if (char === "?" && this.isBlank(at + 1)) {
                at = this.skipFlowBlanks(at + 1)
            }
            const key = this.flowNode(at)
            const afterKey = this.skipFlowBlanks(key.end)
            let value: { node: YamlNode | undefined; end: number } = {
                node: undefined,
                end: afterKey
            }
            if (this.text[afterKey] === ":") {
                value = this.flowValue(afterKey + 1)
            }
            if (key.key !== undefined) {
                entries.push({
                    key: key.key,
                    start: at,
                    end: key.end,
                    isMerge: key.key === MERGE_KEY && this.text[at] === "<",
                    value: value.node
                })
            }
            at = value.end === at ? at + 1 : value.end
        }
    }

    /** The value after a `:` inside a flow collection. A `,` or a closing bracket right after it leaves the value empty. */
    private flowValue(start: number): { node: YamlNode | undefined; end: number } {
        const at = this.skipFlowBlanks(start)
        const char = this.text[at]
        if (char === undefined || char === "," || char === "}" || char === "]") {
            return { node: undefined, end: at }
        }
        return this.flowNode(at)
    }

    /** The end of a plain scalar inside a flow collection: before a flow indicator, a `: `, a comment or the line end. */
    private flowPlainEnd(start: number): number {
        const text = this.text
        let at = start
        while (at < text.length) {
            const char = text[at]!
            if (char === "\n" || char === "\r" || FLOW_INDICATORS.includes(char)) {
                return at
            }
            if (
                char === ":" &&
                (this.isBlank(at + 1) || FLOW_INDICATORS.includes(text[at + 1] ?? ""))
            ) {
                return at
            }
            if (char === "#" && at > start && this.isBlank(at - 1)) {
                return at
            }
            at++
        }
        return at
    }

    /**
     * Reads a key followed by `:` and a blank on one line, plain or quoted.
     * Returns undefined when the line at `start` holds no such key.
     */
    private implicitKeyAt(start: number): ImplicitKey | undefined {
        const text = this.text
        const char = text[start]
        if (char === undefined) {
            return undefined
        }
        if (char === '"' || char === "'") {
            const end = this.quotedEnd(start)
            const colon = this.skipBlanks(end)
            if (text[colon] !== ":" || this.lineEndOf(start) < end) {
                return undefined
            }
            return { text: unquote(text.slice(start, end)), start, end, afterColon: colon + 1 }
        }
        if (NOT_PLAIN_START.includes(char) || ("-?:".includes(char) && this.isBlank(start + 1))) {
            return undefined
        }
        for (let at = start; at < text.length; at++) {
            const current = text[at]
            if (current === "\n") {
                return undefined
            }
            if (current === ":" && this.isBlank(at + 1)) {
                const keyText = text.slice(start, at).trimEnd()
                return { text: keyText, start, end: start + keyText.length, afterColon: at + 1 }
            }
            if (current === "#" && this.isBlank(at - 1)) {
                return undefined
            }
        }
        return undefined
    }

    private isMergeKey(key: ImplicitKey): boolean {
        return key.text === MERGE_KEY && this.text[key.start] === "<"
    }

    /** Reads an anchor (`&name`) and a tag (`!tag`) in any order. `after` points at the first character after them and their blanks. */
    private readProperties(start: number): { anchor: string | undefined; after: number } {
        let anchor: string | undefined
        let at = start
        for (;;) {
            const char = this.text[at]
            if (char === "&") {
                const end = this.anchorNameEnd(at + 1)
                anchor = this.text.slice(at + 1, end)
                at = this.skipBlanks(end)
            } else if (char === "!") {
                at = this.skipBlanks(this.tokenEnd(at))
            } else {
                return { anchor, after: at }
            }
        }
    }

    private anchored(anchor: string | undefined, node: YamlNode | undefined): YamlNode | undefined {
        if (anchor === undefined) {
            return node
        }
        const named = node ?? SCALAR
        this.anchors.set(anchor, named)
        return named
    }

    /**
     * Returns the next content line that sits at `column`, skipping deeper lines that fit no structure.
     * Returns undefined at a shallower line, a document marker or the end of the text.
     */
    private nextLineAt(column: number): number | undefined {
        for (;;) {
            const next = this.peekContent()
            if (next >= this.text.length || this.isAnyDocumentMarker(next)) {
                return undefined
            }
            const nextColumn = this.columnOf(next)
            if (nextColumn < column) {
                return undefined
            }
            if (nextColumn === column) {
                return next
            }
            this.pos = this.nextLineStart(next)
        }
    }

    private skipLinesDeeperThan(indent: number): void {
        for (;;) {
            const next = this.peekContent()
            if (
                next >= this.text.length ||
                this.isAnyDocumentMarker(next) ||
                this.columnOf(next) <= indent
            ) {
                return
            }
            this.pos = this.nextLineStart(next)
        }
    }

    private skipDirectives(): void {
        for (;;) {
            const next = this.peekContent()
            if (this.text[next] !== "%" || this.columnOf(next) !== 0) {
                return
            }
            this.pos = this.nextLineStart(next)
        }
    }

    private skipToNextDocument(): void {
        for (;;) {
            const next = this.peekContent()
            if (next >= this.text.length || this.isDocumentMarker(next, "---")) {
                return
            }
            this.pos = this.nextLineStart(next)
            if (this.isDocumentMarker(next, "...")) {
                return
            }
        }
    }

    /** The first offset from `pos` that holds neither a blank, a line break nor a comment. Leaves `pos` alone. */
    private peekContent(): number {
        let at = this.pos
        for (;;) {
            at = this.skipBlanks(at)
            const char = this.text[at]
            if (char === "\n" || char === "\r") {
                at++
                continue
            }
            if (char === "#" && (at === 0 || this.isBlank(at - 1) || this.text[at - 1] === "\n")) {
                at = this.lineEndOf(at)
                continue
            }
            return at
        }
    }

    /** Skips blanks and line breaks and comments inside a flow collection. */
    private skipFlowBlanks(start: number): number {
        let at = start
        for (;;) {
            const char = this.text[at]
            if (char === " " || char === "\t" || char === "\n" || char === "\r") {
                at++
            } else if (char === "#") {
                at = this.lineEndOf(at)
            } else {
                return at
            }
        }
    }

    private skipBlanks(start: number): number {
        let at = start
        while (this.text[at] === " " || this.text[at] === "\t") {
            at++
        }
        return at
    }

    /** The offset after a quoted scalar that opens at `start`, which may span lines. An unclosed one ends at the end of the text. */
    private quotedEnd(start: number): number {
        const text = this.text
        const quote = text[start]
        let at = start + 1
        while (at < text.length) {
            const char = text[at]
            if (quote === '"' && char === "\\") {
                at += 2
                continue
            }
            if (char === quote) {
                if (quote === "'" && text[at + 1] === "'") {
                    at += 2
                    continue
                }
                return at + 1
            }
            at++
        }
        return text.length
    }

    /** The end of the text on the line of `start`, before a comment and trailing blanks. */
    private contentEnd(start: number): number {
        const text = this.text
        let end = start
        let quote: string | undefined
        for (let at = start; at < text.length && text[at] !== "\n" && text[at] !== "\r"; at++) {
            const char = text[at]!
            if (quote !== undefined) {
                if (char === quote) {
                    quote = undefined
                }
            } else if (char === '"' || char === "'") {
                quote = char
            } else if (char === "#" && this.isBlank(at - 1)) {
                break
            }
            if (char !== " " && char !== "\t") {
                end = at + 1
            }
        }
        return end
    }

    private anchorNameEnd(start: number): number {
        let at = start
        while (
            at < this.text.length &&
            !this.isBlank(at) &&
            !FLOW_INDICATORS.includes(this.text[at]!)
        ) {
            at++
        }
        return at
    }

    private tokenEnd(start: number): number {
        let at = start
        while (at < this.text.length && !this.isBlank(at)) {
            at++
        }
        return at
    }

    private isSequenceEntry(at: number): boolean {
        return this.text[at] === "-" && this.isBlank(at + 1)
    }

    private isDocumentMarker(at: number, marker: "---" | "..."): boolean {
        return this.columnOf(at) === 0 && this.text.startsWith(marker, at) && this.isBlank(at + 3)
    }

    private isAnyDocumentMarker(at: number): boolean {
        return this.isDocumentMarker(at, "---") || this.isDocumentMarker(at, "...")
    }

    /** True for a blank, a line break and the end of the text, the characters that may follow an indicator. */
    private isBlank(at: number): boolean {
        const char = this.text[at]
        return char === undefined || char === " " || char === "\t" || char === "\n" || char === "\r"
    }

    /** True at a line break, a comment and the end of the text. */
    private isLineEnd(at: number): boolean {
        const char = this.text[at]
        return char === undefined || char === "\n" || char === "\r" || char === "#"
    }

    private lineEndOf(at: number): number {
        const end = this.text.indexOf("\n", at)
        return end === -1 ? this.text.length : end
    }

    private nextLineStart(at: number): number {
        const end = this.text.indexOf("\n", at)
        return end === -1 ? this.text.length : end + 1
    }

    private columnOf(at: number): number {
        return at - (this.text.lastIndexOf("\n", at - 1) + 1)
    }
}

/** The text of a quoted scalar on one line, with its escapes resolved. */
function unquote(quoted: string): string {
    const quote = quoted[0]
    const body =
        quoted.endsWith(quote!) && quoted.length > 1 ? quoted.slice(1, -1) : quoted.slice(1)
    if (quote === "'") {
        return body.replaceAll("''", "'")
    }
    return body.replace(
        /\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|.)/g,
        (_, escape: string) => {
            if (escape.length > 1) {
                return codePointEscape(escape.slice(1))
            }
            return ESCAPES[escape] ?? escape
        }
    )
}

const ESCAPES: Record<string, string> = {
    n: "\n",
    t: "\t",
    r: "\r",
    "0": "\0",
    b: "\b",
    f: "\f",
    e: "\u001b",
    a: "\u0007",
    v: "\v",
    N: "\u0085",
    _: " ",
    L: " ",
    P: " "
}
