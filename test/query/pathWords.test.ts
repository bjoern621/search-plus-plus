import { describe, expect, it } from "vitest"
import { parseQuery } from "../../src/query/parseQuery"
import { PathWords, splitWords } from "../../src/query/pathWords"

const rawsFor = (query: string, path: string) =>
    new PathWords(parseQuery(query)).queriesFor(path).map((query) => query.raw)

describe("PathWords", () => {
    it("adds the words that the path leaves out to the whole query", () => {
        expect(rawsFor("web-staging namespac", "deploy-apps/web-staging/values.yaml")).toEqual([
            "web-staging namespac",
            "namespac"
        ])
    })

    it("matches a word with slashes against folders in a row", () => {
        expect(rawsFor("apps/web-staging namespac", "deploy-apps/web-staging/infra.yaml")).toEqual([
            "apps/web-staging namespac",
            "namespac"
        ])
        expect(rawsFor("namespac /infra", "deploy-apps/web-staging/infra.yaml")).toEqual([
            "namespac /infra",
            "namespac"
        ])
    })

    it("matches a word at the start of a word of the path alone", () => {
        const query = "staging namespac"
        expect(rawsFor(query, "deploy-apps/web-staging/infra.yaml")).toEqual([query, "namespac"])
        expect(rawsFor(query, "deploy-apps/webstaging/infra.yaml")).toEqual([query])
    })

    it("keeps the whole query alone for a path with none or all of the words", () => {
        expect(rawsFor("web-staging namespac", "other/infra.yaml")).toEqual([
            "web-staging namespac"
        ])
        expect(rawsFor("web-staging namespac", "namespaces/web-staging.yaml")).toEqual([
            "web-staging namespac"
        ])
    })

    it("matches a path in any case", () => {
        expect(rawsFor("STAGING namespac", "staging/a.yaml")).toEqual([
            "STAGING namespac",
            "namespac"
        ])
    })

    it("leaves quoted words, wildcards and single letters to the lines", () => {
        expect(rawsFor('"staging" namespac', "staging/a.yaml")).toEqual(['"staging" namespac'])
        expect(rawsFor("stag* namespac", "staging/a.yaml")).toEqual(["stag* namespac"])
        expect(rawsFor("s namespac", "staging/a.yaml")).toEqual(["s namespac"])
    })

    it("keeps the whole query alone for a single word", () => {
        expect(rawsFor("staging", "staging/a.yaml")).toEqual(["staging"])
    })

    it("reads the rest of the query as a key path", () => {
        const [, query] = new PathWords(parseQuery("staging metadata.labels")).queriesFor(
            "staging/a.yaml"
        )
        expect(query?.kind === "text" && query.keyPath?.segments.length).toBe(2)
    })
})

describe("splitWords", () => {
    it("keeps a quoted phrase and an escaped space in one word", () => {
        expect(splitWords('a "b c" d\\ e').map((word) => word.raw)).toEqual(["a", '"b c"', "d\\ e"])
    })
})
