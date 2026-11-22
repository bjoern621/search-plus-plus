import { describe, expect, it } from "vitest"
import { editDistance } from "../../src/matching/distance"
import { codePoints, foldText } from "../../src/matching/fold"

describe("editDistance", () => {
    it("counts only the first bLength code points of a reused array", () => {
        const pairs = [
            ["configuration", "configuratoin"],
            ["uri", "url"],
            ["ca", "abc"],
            ["abc", ""]
        ]
        for (const [a, b] of pairs) {
            const reused = [...codePoints(b!), ...codePoints("xyzzy")]
            for (const maxEdits of [0, 1, 2, 3]) {
                expect(editDistance(codePoints(a!), reused, maxEdits, b!.length), `${a} ${b}`).toBe(
                    editDistance(codePoints(a!), codePoints(b!), maxEdits)
                )
            }
        }
    })
})

describe("foldText", () => {
    it("folds ASCII text unit by unit at its own offsets", () => {
        const folded = foldText("Get Config", true)
        expect(folded.text).toBe("get config")
        expect(folded.starts).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
        expect(folded.ends).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
        expect([...folded.foldedOffsets]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    })
})
