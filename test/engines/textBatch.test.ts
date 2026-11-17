import { describe, expect, it } from "vitest"
import { TextBatch } from "../../src/engines/textBatch"

describe("TextBatch", () => {
    it("ends every text in a line feed, so no line of the input spans two texts", () => {
        expect(new TextBatch(["a\nb", "c\r\n", ""]).input).toBe("a\nb\nc\r\n\n")
    })

    it("maps a line of the input back to its text and line", () => {
        const batch = new TextBatch(["a\nb", "c\r\n", "", "d\ne\nf\n"])
        expect([0, 1, 2, 3, 4, 5, 6].map((line) => batch.locate(line))).toEqual([
            { text: 0, line: 0 },
            { text: 0, line: 1 },
            { text: 1, line: 0 },
            { text: 2, line: 0 },
            { text: 3, line: 0 },
            { text: 3, line: 1 },
            { text: 3, line: 2 }
        ])
    })
})
