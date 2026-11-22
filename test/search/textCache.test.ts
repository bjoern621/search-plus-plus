import { describe, expect, it } from "vitest"
import { cachedFile, TextCache } from "../../src/search/worker/textCache"

const file = (size: number, mtimeMs = 1) => cachedFile(mtimeMs, size, "x".repeat(size))

describe("TextCache", () => {
    it("returns a file while it keeps its size and modification time", () => {
        const cache = new TextCache(100)
        const kept = file(10)
        cache.set("/a", kept)
        expect(cache.get("/a", 1, 10)).toBe(kept)
        expect(cache.get("/a", 2, 10)).toBeUndefined()
        expect(cache.get("/a", 1, 10)).toBeUndefined()
    })

    it("drops the least recently read file of an earlier search to make room", () => {
        const cache = new TextCache(30)
        cache.set("/a", file(10))
        cache.set("/b", file(10))
        cache.set("/c", file(10))
        cache.startSearch()
        cache.get("/a", 1, 10)
        cache.set("/d", file(10))
        expect(cache.get("/b", 1, 10)).toBeUndefined()
        expect(cache.get("/a", 1, 10)).toBeDefined()
        expect(cache.get("/c", 1, 10)).toBeDefined()
        expect(cache.get("/d", 1, 10)).toBeDefined()
    })

    it("keeps the files of the running search and skips a file that does not fit", () => {
        const cache = new TextCache(20)
        cache.set("/a", file(10))
        cache.set("/b", file(10))
        cache.set("/c", file(10))
        expect(cache.get("/a", 1, 10)).toBeDefined()
        expect(cache.get("/b", 1, 10)).toBeDefined()
        expect(cache.get("/c", 1, 10)).toBeUndefined()
    })

    it("counts a file set twice once", () => {
        const cache = new TextCache(10)
        cache.set("/a", file(10))
        cache.set("/a", file(10, 2))
        expect(cache.get("/a", 2, 10)).toBeDefined()
    })

    it("keeps a binary file without folds", () => {
        const binary = cachedFile(1, 4, undefined)
        expect(binary.folds).toBeUndefined()
        expect(binary.memos.size).toBe(0)
    })
})
