import { describe, expect, it } from "vitest"
import { hintFor } from "../../src/query/hints"
import { parseQuery } from "../../src/query/parseQuery"

describe("hintFor", () => {
    it("confirms a regex query in the highlight tone", () => {
        expect(hintFor(parseQuery("/a+/"))).toEqual({
            text: "Searching as a regex.",
            tone: "highlight"
        })
    })

    it("asks for the closing slash after a leading one and suggests the query with it", () => {
        expect(hintFor(parseQuery("/a+"))).toEqual({
            text: "End with a slash to search as a regex.",
            tone: "info",
            suggestedQuery: "/a+/"
        })
        expect(hintFor(parseQuery("/"))).toMatchObject({ suggestedQuery: "//" })
    })

    it("asks for the closing slash after an escaped one", () => {
        expect(hintFor(parseQuery("/a\\/"))).toMatchObject({
            text: "End with a slash to search as a regex."
        })
    })

    it("passes on the message of a broken key path", () => {
        expect(hintFor(parseQuery("a[b"))).toEqual({
            text: "The key path skips this query because a bracket ([) stays open. Close it with ].",
            tone: "info"
        })
    })

    it("gives no hint for a valid key path or plain text", () => {
        expect(hintFor(parseQuery("global.values.gravitee.enabled"))).toBeUndefined()
        expect(hintFor(parseQuery("hello world"))).toBeUndefined()
    })

    it("gives no hint for an empty query", () => {
        expect(hintFor(parseQuery(""))).toBeUndefined()
    })

    it("wraps the message of a regex that cannot compile and suggests the query without slashes", () => {
        expect(hintFor(parseQuery("/a(/"), "unclosed group.")).toEqual({
            text: "The regex cannot compile: unclosed group. Fix it or drop the slashes.",
            tone: "info",
            suggestedQuery: "a("
        })
    })

    it("ignores a regex error for a text query", () => {
        expect(hintFor(parseQuery("a"), "unclosed group")).toBeUndefined()
    })
})
