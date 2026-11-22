import { writeFile } from "node:fs/promises"
import * as path from "node:path"
import { describe, expect, it, vi } from "vitest"
import { LISTING_RELIST_DELAY_DURATION_MS } from "../../src/search/config"
import {
    collectFiles,
    forgetListings,
    isIgnoreFile,
    relistReused,
    trustListings
} from "../../src/search/files"
import type { SearchRoot } from "../../src/search/workspaceEngine"
import { folderWith, ripgrepOnPath, rootAt } from "./runnerSetup"

const rgPath = ripgrepOnPath()

async function listed(root: SearchRoot, signal = new AbortController().signal): Promise<string[]> {
    const files = await collectFiles([root], rgPath, signal, () => {})
    return files.map((file) => file.relativePath).sort()
}

// The listings live in the module, so this file trusts them for each of its tests.
trustListings()

describe("collectFiles with trusted listings", () => {
    it("takes the last listing until forgetListings", async () => {
        const dir = await folderWith({ "a.txt": "" })
        const root = rootAt(0, dir)
        expect(await listed(root)).toEqual(["a.txt"])
        await writeFile(path.join(dir, "b.txt"), "")
        expect(await listed(root)).toEqual(["a.txt"])
        forgetListings()
        expect(await listed(root)).toEqual(["a.txt", "b.txt"])
    })

    it("lists anew once the walk of the root changed", async () => {
        const dir = await folderWith({ "a.txt": "", "b.log": "" })
        const root = rootAt(0, dir)
        expect(await listed(root)).toEqual(["a.txt", "b.log"])
        root.walk = { ...root.walk, excludeGlobs: ["**/*.log"] }
        expect(await listed(root)).toEqual(["a.txt"])
    })

    it("keeps no listing of a cancelled search", async () => {
        const dir = await folderWith({ "a.txt": "" })
        const root = rootAt(0, dir)
        const cancelled = new AbortController()
        cancelled.abort()
        await listed(root, cancelled.signal)
        await writeFile(path.join(dir, "b.txt"), "")
        expect(await listed(root)).toEqual(["a.txt", "b.txt"])
    })

    it("replaces a taken listing in the background once no search called relistReused for a while", async () => {
        const dir = await folderWith({ "a.txt": "" })
        const root = rootAt(0, dir)
        await listed(root)
        await writeFile(path.join(dir, "b.txt"), "")
        expect(await listed(root)).toEqual(["a.txt"])
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
        try {
            relistReused(rgPath, () => {})
            vi.advanceTimersByTime(LISTING_RELIST_DELAY_DURATION_MS - 1)
            relistReused(rgPath, () => {})
            vi.advanceTimersByTime(LISTING_RELIST_DELAY_DURATION_MS - 1)
            expect(await listed(root)).toEqual(["a.txt"])
            vi.advanceTimersByTime(1)
        } finally {
            vi.useRealTimers()
        }
        await vi.waitFor(async () => expect(await listed(root)).toEqual(["a.txt", "b.txt"]))
    })
})

describe("isIgnoreFile", () => {
    it("names the files that decide what ripgrep lists", () => {
        expect(isIgnoreFile(".gitignore")).toBe(true)
        expect(isIgnoreFile("src/.ignore")).toBe(true)
        expect(isIgnoreFile("/repo/.rgignore")).toBe(true)
        expect(isIgnoreFile("/repo/.git/info/exclude")).toBe(true)
        expect(isIgnoreFile("/repo/my.gitignore")).toBe(false)
        expect(isIgnoreFile("/repo/src/index.ts")).toBe(false)
    })
})
