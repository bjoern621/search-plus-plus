import { describe, expect, it } from "vitest"
import { parseQuery } from "../../src/query/parseQuery"
import { NameMatcher } from "../../src/search/names"

const match = (query: string, path: string) => new NameMatcher(parseQuery(query)).match(path)

describe("NameMatcher", () => {
    it("matches the last name of a path", () => {
        expect(match("staging", "deploy/web-staging")).toEqual([{ start: 11, end: 18 }])
        expect(match("values", "deploy/web-staging/values.yaml")).toEqual([{ start: 19, end: 25 }])
    })

    it("leaves out a path whose match sits in a folder above", () => {
        expect(match("staging", "deploy/web-staging/values.yaml")).toBeUndefined()
    })

    it("spans folders with a slash in the query", () => {
        expect(match("apps/web", "deploy-apps/web-staging")).toEqual([{ start: 7, end: 15 }])
        expect(match("apps/web", "deploy-apps/web-staging/values.yaml")).toBeUndefined()
    })

    it("keeps the typos and umlaut variants of the line search", () => {
        expect(match("stagign", "deploy/staging")).toBeDefined()
        expect(match("grosse", "docs/größe.md")).toBeDefined()
    })

    it("matches no path for a regex query", () => {
        expect(match("/stag/", "deploy/staging")).toBeUndefined()
    })
})
