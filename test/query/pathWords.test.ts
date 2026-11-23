import { describe, expect, it } from "vitest"
import { parseQuery } from "../../src/query/parseQuery"
import { PathWords, splitWords } from "../../src/query/pathWords"

const rawFor = (query: string, path: string) => new PathWords(parseQuery(query)).queryFor(path).raw

describe("PathWords", () => {
    it("searches the lines with the words that the path leaves out", () => {
        expect(rawFor("web-staging namespac", "deploy-apps/web-staging/values.yaml")).toBe(
            "namespac"
        )
    })

    it("matches a word with slashes against folders in a row", () => {
        expect(rawFor("apps/web-staging namespac", "deploy-apps/web-staging/infra.yaml")).toBe(
            "namespac"
        )
        expect(rawFor("namespac /infra", "deploy-apps/web-staging/infra.yaml")).toBe("namespac")
    })

    it("matches a word at the start of a word of the path alone", () => {
        const query = "staging namespac"
        expect(rawFor(query, "deploy-apps/web-staging/infra.yaml")).toBe("namespac")
        expect(rawFor(query, "deploy-apps/webstaging/infra.yaml")).toBe(query)
    })

    it("keeps the whole query for a path with none or all of the words", () => {
        expect(rawFor("web-staging namespac", "other/infra.yaml")).toBe("web-staging namespac")
        expect(rawFor("web-staging namespac", "namespaces/web-staging.yaml")).toBe(
            "web-staging namespac"
        )
    })

    it("matches a path in any case", () => {
        expect(rawFor("STAGING namespac", "staging/a.yaml")).toBe("namespac")
    })

    it("leaves quoted words, wildcards and single letters to the lines", () => {
        expect(rawFor('"staging" namespac', "staging/a.yaml")).toBe('"staging" namespac')
        expect(rawFor("stag* namespac", "staging/a.yaml")).toBe("stag* namespac")
        expect(rawFor("s namespac", "staging/a.yaml")).toBe("s namespac")
    })

    it("keeps one query for a single word", () => {
        expect(rawFor("staging", "staging/a.yaml")).toBe("staging")
    })

    it("reads the rest of the query as a key path", () => {
        const query = new PathWords(parseQuery("staging metadata.labels")).queryFor(
            "staging/a.yaml"
        )
        expect(query.kind === "text" && query.keyPath?.segments.length).toBe(2)
    })
})

describe("splitWords", () => {
    it("keeps a quoted phrase and an escaped space in one word", () => {
        expect(splitWords('a "b c" d\\ e').map((word) => word.raw)).toEqual(["a", '"b c"', "d\\ e"])
    })
})
