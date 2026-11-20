import { describe, expect, it } from "vitest"
import type { KeyPathFiles } from "../../src/api"
import { parseQuery } from "../../src/query"
import { tomlEngine } from "../../src/structural"
import { keyPathEngine } from "../../src/structural/keyPathEngine"
import { propertiesFiles } from "./propertiesFiles"
import { found, highlighted, search } from "./search"

const properties = [
    "# Server",
    "server.http.port = 8080",
    "server.http.host = localhost",
    "database.pool.port = 5432",
    "app.name = demo"
].join("\n")

const propertiesEngine = keyPathEngine(propertiesFiles)

function inProperties(query: string) {
    return search(propertiesEngine, "conf/app.properties", "properties", properties, query)
}

describe("keyPathEngine", () => {
    it("finds a key path of three keys and highlights the last key", () => {
        const matches = inProperties("server.http.port")
        expect(found(matches)).toEqual(["2: server.http.port"])
        expect(highlighted(properties, matches)).toEqual(["port"])
        expect(matches[0]!.reasons).toEqual([])
    })

    it("finds a key a few edits away and names the edit", () => {
        const matches = inProperties("server.htp.port")
        expect(found(matches)).toEqual(["2: server.http.port"])
        expect(matches[0]!.reasons).toEqual([
            { kind: "fuzzy", query: "htp", found: "http", edits: 1 }
        ])
    })

    it("finds a key at any depth below a globstar", () => {
        expect(found(inProperties("**.port"))).toEqual([
            "2: server.http.port",
            "4: database.pool.port"
        ])
    })

    it("sets showKeyPath for the same queries as the TOML engine", () => {
        const toml = properties.replace(/^(\S+) = (\S+)$/gm, '$1 = "$2"')
        for (const query of ["server.http.port", "**.port", "server.htp.port", "app", "*"]) {
            const fromToml = search(tomlEngine, "app.toml", "toml", toml, query)
            expect(inProperties(query).map((match) => match.showKeyPath)).toEqual(
                fromToml.map((match) => match.showKeyPath)
            )
        }
        expect(inProperties("**.port")[0]!.showKeyPath).toBe(true)
        expect(inProperties("app")[0]!.showKeyPath).toBeUndefined()
    })

    it("accepts a file by its language ID or by its extension in any case", () => {
        const query = parseQuery("app.name")
        const file = (relativePath: string, languageId: string) => ({
            uri: `file:///${relativePath}`,
            relativePath,
            languageId
        })
        expect(propertiesEngine.accepts(file("a.PROPERTIES", "plaintext"), query)).toBe(true)
        expect(propertiesEngine.accepts(file("a.conf", "properties"), query)).toBe(true)
        expect(propertiesEngine.accepts(file("a.conf", "plaintext"), query)).toBe(false)
        expect(propertiesEngine.accepts(file("a.properties", "plaintext"), parseQuery("/a/"))).toBe(
            false
        )
    })

    it("returns no matches once the search gets cancelled", () => {
        const lines = Array.from({ length: 5000 }, (_, i) => `key${i}.port = ${i}`).join("\n")
        const stop = new AbortController()
        stop.abort()
        const file = {
            uri: "file:///big.properties",
            relativePath: "big.properties",
            languageId: "properties",
            text: lines
        }
        expect(propertiesEngine.search(file, parseQuery("**.port"), stop.signal)).toEqual([])
    })

    it("rejects a file type that names no file and an extension without its dot", () => {
        const withFiles = (languageIds: string[], extensions: string[]): KeyPathFiles => ({
            ...propertiesFiles,
            languageIds,
            extensions
        })
        expect(() => keyPathEngine(withFiles([], []))).toThrow("names no language ID")
        expect(() => keyPathEngine(withFiles([], ["properties"]))).toThrow("must start with a dot")
    })
})
