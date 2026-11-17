import { describe, expect, it } from "vitest"
import {
    entryGlobs,
    expandBraces,
    fieldGlobs,
    globToRegExp,
    PathFilter,
    splitEntries,
    turnedOnGlobs
} from "../../src/search/globs"

describe("splitEntries", () => {
    it("splits at commas outside braces and drops empty entries", () => {
        expect(splitEntries(" *.yaml, {a,b}/c ,, ./docs/ ")).toEqual([
            "*.yaml",
            "{a,b}/c",
            "./docs/"
        ])
    })
})

describe("entryGlobs", () => {
    it("matches an entry without a leading ./ at any depth", () => {
        expect(entryGlobs("docs")).toEqual(["**/docs", "**/docs/**"])
    })

    it("starts an entry with ./ or / at the workspace folder", () => {
        expect(entryGlobs("./charts/apim/")).toEqual(["charts/apim", "charts/apim/**"])
        expect(entryGlobs("/charts")).toEqual(["charts", "charts/**"])
    })

    it("keeps an entry that covers its subtree already", () => {
        expect(entryGlobs("vendor/**")).toEqual(["**/vendor/**"])
        expect(entryGlobs("**")).toEqual(["**"])
    })
})

describe("globToRegExp", () => {
    const matches = (glob: string, path: string) => globToRegExp(glob).test(path)

    it("keeps * and ? inside one folder", () => {
        expect(matches("*.yaml", "values.yaml")).toBe(true)
        expect(matches("*.yaml", "charts/values.yaml")).toBe(false)
        expect(matches("v?lues.yaml", "values.yaml")).toBe(true)
    })

    it("lets **/ span no folder or several", () => {
        expect(matches("**/values.yaml", "values.yaml")).toBe(true)
        expect(matches("**/values.yaml", "charts/apim/values.yaml")).toBe(true)
        expect(matches("charts/**", "charts/apim/values.yaml")).toBe(true)
        expect(matches("charts/**", "chartsx/values.yaml")).toBe(false)
    })

    it("reads braces and brackets as in VS Code", () => {
        expect(matches("*.{yaml,json}", "a.json")).toBe(true)
        expect(matches("*.{yaml,json}", "a.toml")).toBe(false)
        expect(matches("file[0-9].md", "file3.md")).toBe(true)
        expect(matches("file[!0-9].md", "file3.md")).toBe(false)
    })

    it("matches an unclosed bracket or brace as itself", () => {
        expect(matches("a[b", "a[b")).toBe(true)
        expect(matches("a{b", "a{b")).toBe(true)
    })
})

describe("PathFilter", () => {
    it("lets every file pass with both fields empty", () => {
        expect(new PathFilter({ include: "", exclude: "" }).accepts("any/file.ts")).toBe(true)
    })

    it("keeps the files that an include entry names and drops the ones that an exclude entry names", () => {
        const filter = new PathFilter({ include: "*.yaml, ./docs", exclude: "./charts/apim/" })
        expect(filter.accepts("docs/upgrade.md")).toBe(true)
        expect(filter.accepts("build/values.yaml")).toBe(true)
        expect(filter.accepts("charts/apim/values.yaml")).toBe(false)
        expect(filter.accepts("src/main.ts")).toBe(false)
    })

    it("drops a folder at any depth for an entry without a leading ./", () => {
        const filter = new PathFilter({ include: "", exclude: "docs/" })
        expect(filter.accepts("docs/a.md")).toBe(false)
        expect(filter.accepts("src/docs/a.md")).toBe(false)
        expect(filter.accepts("docsite/a.md")).toBe(true)
    })
})

describe("fieldGlobs", () => {
    it("expands every entry of a field", () => {
        expect(fieldGlobs("./a, b")).toEqual(["a", "a/**", "**/b", "**/b/**"])
    })
})

describe("expandBraces", () => {
    it("gives one glob per alternative of each group, nested groups included", () => {
        expect(expandBraces("**/*.{log,tmp}")).toEqual(["**/*.log", "**/*.tmp"])
        expect(expandBraces("{a,b{c,d}}/{x,}")).toEqual(["a/x", "a/", "bc/x", "bc/", "bd/x", "bd/"])
    })

    it("leaves a glob without braces and a group that never closes as written", () => {
        expect(expandBraces("**/node_modules")).toEqual(["**/node_modules"])
        expect(expandBraces("**/{a,b")).toEqual(["**/{a,b"])
    })
})

describe("turnedOnGlobs", () => {
    it("keeps the globs that hold true", () => {
        expect(
            turnedOnGlobs({
                "**/.DS_Store": true,
                "**/dist": false,
                "**/*.js": { when: "$(basename).ts" }
            })
        ).toEqual(["**/.DS_Store"])
    })
})
