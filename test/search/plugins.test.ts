import { describe, expect, it } from "vitest"
import { API_VERSION, type SearchEngine } from "../../src/api"
import { propertiesFiles } from "../structural/propertiesFiles"
import { folderWith, matchedLines, rootAt, runSearch } from "./runnerSetup"

/** Finds the query spelled backwards in `.notes` files, which the text engine never finds. */
const backwardsEngine: SearchEngine = {
    id: "backwards",
    accepts: (file, query) => query.kind === "text" && file.relativePath.endsWith(".notes"),
    search(file, query) {
        const needle = [...query.raw].reverse().join("")
        return file.text.split("\n").flatMap((text, line) => {
            const start = text.indexOf(needle)
            if (start === -1) return []
            return [{ line, ranges: [{ start, end: start + needle.length }], reasons: [] }]
        })
    }
}

describe("engines of other extensions", () => {
    it("runs an engine registered through the API", async () => {
        const dir = await folderWith({ "a.notes": "first\nwolley\n", "b.txt": "wolley\n" })
        const result = await runSearch("yellow", [rootAt(0, dir)], {
            plugins: (api) => api.registerEngine(backwardsEngine)
        })
        expect(result.outcome).toEqual({ status: "complete" })
        expect(matchedLines(result.files)).toEqual(["a.notes:2: wolley"])
    })

    it("drops a match outside the file and searches on after an engine throws", async () => {
        const dir = await folderWith({ "a.notes": "wolley\n" })
        const result = await runSearch("yellow", [rootAt(0, dir)], {
            plugins: (api) => {
                api.registerEngine(backwardsEngine)
                api.registerEngine({
                    id: "outside",
                    accepts: () => true,
                    search: () => [{ line: 99, ranges: [], reasons: [] }]
                })
                api.registerEngine({
                    id: "broken",
                    accepts: () => true,
                    search: () => {
                        throw new Error("parser crashed")
                    }
                })
            }
        })
        expect(matchedLines(result.files)).toEqual(["a.notes:1: wolley"])
        expect(result.log.join("\n")).toContain("Search engine broken could not search a.notes")
    })

    it("leaves out an engine once its registration gets disposed", async () => {
        const dir = await folderWith({ "a.notes": "wolley\n" })
        const result = await runSearch("yellow", [rootAt(0, dir)], {
            plugins: (api) => api.registerEngine(backwardsEngine).dispose()
        })
        expect(matchedLines(result.files)).toEqual([])
    })

    it("finds key paths in a file type registered through registerKeyPathFiles", async () => {
        const dir = await folderWith({
            "app.properties": "server.http.port = 8080\ndatabase.pool.port = 5432\n"
        })
        const result = await runSearch("**.port", [rootAt(0, dir)], {
            plugins: (api) => api.registerKeyPathFiles(propertiesFiles)
        })
        expect(matchedLines(result.files)).toEqual([
            "app.properties:1: server.http.port = 8080",
            "app.properties:2: database.pool.port = 5432"
        ])
        const rows = result.files.flatMap((file) => file.blocks.flat())
        expect(rows.map((row) => [row.keyPath?.join("."), row.showKeyPath])).toEqual([
            ["server.http.port", true],
            ["database.pool.port", true]
        ])
    })

    it("reports the version of the API", async () => {
        const dir = await folderWith({})
        let apiVersion: number | undefined
        await runSearch("x", [rootAt(0, dir)], {
            plugins: (api) => {
                apiVersion = api.apiVersion
            }
        })
        expect(apiVersion).toBe(API_VERSION)
    })
})
