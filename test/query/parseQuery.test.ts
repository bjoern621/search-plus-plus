import { describe, expect, it } from "vitest"
import { isRegexQuery, literalQuery, parseQuery, parseTextPieces } from "../../src/query/parseQuery"

describe("parseQuery", () => {
    it("reads a query between two slashes as a regex without the slashes", () => {
        expect(parseQuery("/4\\.\\d+\\.\\d+/")).toEqual({
            kind: "regex",
            raw: "/4\\.\\d+\\.\\d+/",
            source: "4\\.\\d+\\.\\d+"
        })
    })

    it("reads two slashes alone as an empty regex", () => {
        expect(parseQuery("//")).toEqual({ kind: "regex", raw: "//", source: "" })
    })

    it("reads a single slash as text", () => {
        expect(parseQuery("/").kind).toBe("text")
    })

    it("reads a query with a leading slash and no closing one as text", () => {
        expect(parseQuery("/4\\.\\d+").kind).toBe("text")
    })

    it("needs the closing slash unescaped", () => {
        expect(parseQuery("/a\\/").kind).toBe("text")
        expect(parseQuery("/a\\\\/")).toMatchObject({ kind: "regex", source: "a\\\\" })
    })

    it("parses a plain domain as a key path of two keys", () => {
        const query = parseQuery("example.com")
        expect(query).toMatchObject({
            kind: "text",
            keyPath: {
                segments: [
                    { kind: "key", pieces: [{ kind: "literal", value: "example" }] },
                    { kind: "key", pieces: [{ kind: "literal", value: "com" }] }
                ]
            }
        })
        expect(query.kind === "text" && query.keyPathError).toBeUndefined()
    })

    it("parses a single word as a key path of one key", () => {
        expect(parseQuery("enabled")).toMatchObject({
            keyPath: {
                segments: [{ kind: "key", pieces: [{ kind: "literal", value: "enabled" }] }]
            }
        })
    })

    it("keeps the pieces and drops the key path when the key path grammar breaks", () => {
        const query = parseQuery("v[0-9")
        expect(query.kind === "text" && query.keyPath).toBeUndefined()
        expect(query).toMatchObject({
            kind: "text",
            pieces: [
                { kind: "word", value: "v", exact: false },
                { kind: "literal", value: "[" },
                { kind: "word", value: "0" },
                { kind: "literal", value: "-" },
                { kind: "word", value: "9" }
            ],
            keyPathError: { range: { start: 1, end: 2 } }
        })
    })

    it("rejects a Helm reference with its leading dot as key path", () => {
        expect(parseQuery(".Values.global.domain")).toMatchObject({
            keyPathError: { range: { start: 0, end: 1 } }
        })
    })
})

describe("parseTextPieces", () => {
    it("splits words from the characters between them", () => {
        expect(parseTextPieces("console.log(*)")).toEqual([
            { kind: "word", value: "console", exact: false },
            { kind: "literal", value: "." },
            { kind: "word", value: "log", exact: false },
            { kind: "literal", value: "(" },
            { kind: "wildcard" },
            { kind: "literal", value: ")" }
        ])
    })

    it("counts Unicode letters and digits as word characters", () => {
        expect(parseTextPieces("Größe 42")).toEqual([
            { kind: "word", value: "Größe", exact: false },
            { kind: "literal", value: " " },
            { kind: "word", value: "42", exact: false }
        ])
    })

    it("turns an escaped star into a literal star", () => {
        expect(parseTextPieces("import \\* as fs")).toEqual([
            { kind: "word", value: "import", exact: false },
            { kind: "literal", value: " * " },
            { kind: "word", value: "as", exact: false },
            { kind: "literal", value: " " },
            { kind: "word", value: "fs", exact: false }
        ])
    })

    it("turns any escaped character into a literal", () => {
        expect(parseTextPieces("a\\bc")).toEqual([
            { kind: "word", value: "a", exact: false },
            { kind: "literal", value: "b" },
            { kind: "word", value: "c", exact: false }
        ])
    })

    it("keeps a trailing backslash as a literal", () => {
        expect(parseTextPieces("a\\")).toEqual([
            { kind: "word", value: "a", exact: false },
            { kind: "literal", value: "\\" }
        ])
    })

    it("makes quoted words exact and drops the quotes", () => {
        expect(parseTextPieces('find "Größe" now')).toEqual([
            { kind: "word", value: "find", exact: false },
            { kind: "literal", value: " " },
            { kind: "word", value: "Größe", exact: true },
            { kind: "literal", value: " " },
            { kind: "word", value: "now", exact: false }
        ])
    })

    it("keeps a star inside quotes literal", () => {
        expect(parseTextPieces('"a*b"')).toEqual([
            { kind: "word", value: "a", exact: true },
            { kind: "literal", value: "*" },
            { kind: "word", value: "b", exact: true }
        ])
    })

    it("turns escaped quotes into literal quotes", () => {
        expect(parseTextPieces('\\"hello\\"')).toEqual([
            { kind: "literal", value: '"' },
            { kind: "word", value: "hello", exact: false },
            { kind: "literal", value: '"' }
        ])
    })

    it("quotes the rest of the query after a quote left open", () => {
        expect(parseTextPieces('a "b')).toEqual([
            { kind: "word", value: "a", exact: false },
            { kind: "literal", value: " " },
            { kind: "word", value: "b", exact: true }
        ])
    })

    it("keeps words on both sides of a quote apart", () => {
        expect(parseTextPieces('ab"cd"')).toEqual([
            { kind: "word", value: "ab", exact: false },
            { kind: "word", value: "cd", exact: true }
        ])
    })

    it("joins neighbouring stars into one wildcard", () => {
        expect(parseTextPieces("a**b")).toEqual([
            { kind: "word", value: "a", exact: false },
            { kind: "wildcard" },
            { kind: "word", value: "b", exact: false }
        ])
    })

    it("returns no pieces for an empty query", () => {
        expect(parseTextPieces("")).toEqual([])
    })
})

describe("literalQuery", () => {
    it("escapes stars, backslashes and quotes, so each matches itself", () => {
        const query = literalQuery('import * as "fs" from a\\b')
        expect(query).toBe('import \\* as \\"fs\\" from a\\\\b')
        expect(parseTextPieces(query).filter((piece) => piece.kind === "wildcard")).toEqual([])
    })

    it("escapes the first slash of text that would read as a regex", () => {
        const query = literalQuery("/api/")
        expect(isRegexQuery(query)).toBe(false)
        expect(parseTextPieces(query)).toEqual([
            { kind: "literal", value: "/" },
            { kind: "word", value: "api", exact: false },
            { kind: "literal", value: "/" }
        ])
    })

    it("leaves a path that holds slashes unescaped", () => {
        expect(literalQuery("apps/web")).toBe("apps/web")
    })
})
