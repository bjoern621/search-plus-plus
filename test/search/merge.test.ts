import { describe, expect, it } from "vitest"
import { mergeLineMatches, unionRanges } from "../../src/search/merge"

describe("mergeLineMatches", () => {
    it("shows a line that two engines find once, with the union of ranges and reasons", () => {
        const fuzzy = { kind: "fuzzy" as const, query: "gravite", found: "gravitee", edits: 1 }
        const merged = mergeLineMatches([
            [{ line: 4, ranges: [{ start: 2, end: 9 }], reasons: [fuzzy] }],
            [
                {
                    line: 4,
                    ranges: [{ start: 7, end: 12 }],
                    reasons: [fuzzy],
                    keyPath: ["global", "enabled"]
                },
                { line: 1, ranges: [{ start: 0, end: 1 }], reasons: [] }
            ]
        ])
        expect(merged).toEqual([
            { line: 1, ranges: [{ start: 0, end: 1 }], reasons: [] },
            {
                line: 4,
                ranges: [{ start: 2, end: 12 }],
                reasons: [fuzzy],
                keyPath: ["global", "enabled"]
            }
        ])
    })

    it("leaves the engine results unchanged", () => {
        const list = [{ line: 0, ranges: [{ start: 3, end: 4 }], reasons: [] }]
        mergeLineMatches([list, [{ line: 0, ranges: [{ start: 0, end: 1 }], reasons: [] }]])
        expect(list[0]?.ranges).toEqual([{ start: 3, end: 4 }])
    })
})

describe("unionRanges", () => {
    it("joins overlapping and touching ranges and drops empty ones", () => {
        expect(
            unionRanges([
                { start: 8, end: 10 },
                { start: 0, end: 2 },
                { start: 2, end: 4 },
                { start: 5, end: 5 },
                { start: 9, end: 12 }
            ])
        ).toEqual([
            { start: 0, end: 4 },
            { start: 8, end: 12 }
        ])
    })

    it("rejects a range that ends before it starts", () => {
        expect(() => unionRanges([{ start: 3, end: 1 }])).toThrow(/end at or after its start/)
    })
})
