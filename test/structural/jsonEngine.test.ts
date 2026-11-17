import { describe, expect, it } from "vitest"
import { parseQuery } from "../../src/query"
import { jsonEngine } from "../../src/structural"
import { fixture, found, highlighted, search } from "./search"

const tsconfig = fixture("tsconfig.json")
const manifest = fixture("package.json")

describe("jsonEngine", () => {
    it("reads comments and trailing commas as in tsconfig.json", () => {
        expect(
            found(search(jsonEngine, "tsconfig.json", "jsonc", tsconfig, "compilerOptions.strict"))
        ).toEqual(["6: compilerOptions.strict"])
        expect(
            found(
                search(
                    jsonEngine,
                    "tsconfig.json",
                    "jsonc",
                    tsconfig,
                    "compilerOptions.paths.@/\\*.0"
                )
            )
        ).toEqual(["7: compilerOptions.paths.@/*.0"])
    })

    it("finds array items by index and keys below them", () => {
        expect(found(search(jsonEngine, "package.json", "json", manifest, "include.1"))).toEqual([])
        expect(found(search(jsonEngine, "tsconfig.json", "jsonc", tsconfig, "include.1"))).toEqual([
            "9: include.1"
        ])
        expect(
            found(
                search(
                    jsonEngine,
                    "package.json",
                    "json",
                    manifest,
                    "contributes.commands.*.command"
                )
            )
        ).toEqual(["9: contributes.commands.0.command", "10: contributes.commands.1.command"])
    })

    it("finds keys at any depth with **", () => {
        expect(found(search(jsonEngine, "package.json", "json", manifest, "**.test"))).toEqual([
            "5: scripts.test"
        ])
    })

    it("finds close spellings and reports them", () => {
        const matches = search(jsonEngine, "package.json", "json", manifest, "scripst.build")
        expect(found(matches)).toEqual(["4: scripts.build"])
        expect(matches[0]!.reasons).toEqual([
            { kind: "fuzzy", query: "scripst", found: "scripts", edits: 1 }
        ])
    })

    it("highlights the key of a property and the value of an array item", () => {
        const matches = search(
            jsonEngine,
            "package.json",
            "json",
            manifest,
            "contributes.commands.1.title"
        )
        expect(highlighted(manifest, matches)).toEqual(['"title"'])
        expect(
            highlighted(
                tsconfig,
                search(jsonEngine, "tsconfig.json", "jsonc", tsconfig, "include.0")
            )
        ).toEqual(['"src"'])
        expect(
            highlighted(
                manifest,
                search(jsonEngine, "package.json", "json", manifest, "contributes.commands.0")
            )
        ).toEqual(["{"])
    })

    it("finds several matches on one line", () => {
        const text = '{"a": {"enabled": true}, "b": {"enabled": false}}'
        expect(found(search(jsonEngine, "one.json", "json", text, "*.enabled"))).toEqual([
            "1: a.enabled",
            "1: b.enabled"
        ])
    })

    it("keeps the readable keys of a broken file and throws nothing", () => {
        const text = '{\n  "a": { "b": 1,,\n  "c": [1, 2\n}\n'
        expect(() => search(jsonEngine, "broken.json", "json", text, "**.b")).not.toThrow()
        expect(found(search(jsonEngine, "broken.json", "json", text, "a.b"))).toEqual(["2: a.b"])
    })

    it("accepts JSON files by language or extension", () => {
        const query = parseQuery("a.b")
        const file = (relativePath: string, languageId: string) => ({
            uri: `file:///${relativePath}`,
            relativePath,
            languageId
        })
        expect(jsonEngine.accepts(file("tsconfig.json", "jsonc"), query)).toBe(true)
        expect(jsonEngine.accepts(file("data.json", "plaintext"), query)).toBe(true)
        expect(jsonEngine.accepts(file("values.yaml", "yaml"), query)).toBe(false)
    })
})
