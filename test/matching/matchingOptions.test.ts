import { describe, expect, it } from "vitest"
import { findInLine } from "../../src/matching"
import { parseTextPieces } from "../../src/query/parseQuery"
import { DEFAULT_MATCHING, type MatchingOptions } from "../../src/search/types"
import { compareKeyUnder } from "../../src/structural"

function found(line: string, query: string, options: Partial<MatchingOptions>): string[] {
    const matching = { ...DEFAULT_MATCHING, ...options }
    return findInLine(line, parseTextPieces(query), matching).map((match) =>
        line.slice(match.ranges[0]!.start, match.ranges[0]!.end)
    )
}

describe("findInLine under matchCase", () => {
    it("finds the word in its own case alone", () => {
        expect(found("secret Secret SECRET", "Secret", { matchCase: true })).toEqual(["Secret"])
    })

    it("counts no case difference as a close spelling", () => {
        expect(found("Secret secrets", "secret", { matchCase: true })).toEqual(["secret"])
    })

    it("keeps close spellings in the same case", () => {
        expect(found("socket Socket", "secret", { matchCase: true })).toEqual(["socket"])
    })

    it("keeps umlaut variants in the same case", () => {
        expect(found("Groesse groesse", "Größe", { matchCase: true })).toEqual(["Groesse"])
    })
})

describe("findInLine under matchWholeWord", () => {
    it("finds whole words alone", () => {
        expect(found("gravitee grav useGrav", "grav", { matchWholeWord: true })).toEqual(["grav"])
    })

    it("finds close spellings that span a whole word", () => {
        expect(found("getGraviteeConfig gravitie", "gravitee", { matchWholeWord: true })).toEqual([
            "gravitie"
        ])
    })

    it("holds for quoted words", () => {
        expect(found("rpc rpcs", '"rpc"', { matchWholeWord: true })).toEqual(["rpc"])
    })
})

describe("findInLine without umlautVariants", () => {
    it("finds the spelling of the query alone", () => {
        expect(found("Größe Groesse GRÖßE", "Größe", { umlautVariants: false })).toEqual([
            "Größe",
            "GRÖßE"
        ])
    })
})

describe("findInLine without fuzzy", () => {
    it("finds no close spelling", () => {
        expect(found("socket secret", "secret", { fuzzy: false })).toEqual(["secret"])
    })
})

describe("findInLine with fuzzy thresholds", () => {
    it("allows no edit below oneEditMinLetters", () => {
        expect(found("socket", "sockxt", {})).toEqual(["socket"])
        expect(found("socket", "sockxt", { oneEditMinLetters: 7, twoEditsMinLetters: 8 })).toEqual(
            []
        )
    })

    it("allows one edit below twoEditsMinLetters", () => {
        expect(found("secret", "secrxx", {})).toEqual(["secret"])
        expect(found("secret", "secrxx", { twoEditsMinLetters: 7 })).toEqual([])
    })
})

describe("compareKeyUnder", () => {
    const whole = { exact: false, fuzzy: true }

    it("matches a key in another case under the defaults alone", () => {
        expect(compareKeyUnder(DEFAULT_MATCHING)("Enabled", "enabled", whole)).toBeDefined()
        expect(
            compareKeyUnder({ ...DEFAULT_MATCHING, matchCase: true })("Enabled", "enabled", whole)
        ).toBeUndefined()
    })

    it("matches no close key without fuzzy", () => {
        expect(compareKeyUnder(DEFAULT_MATCHING)("gravite", "gravitee", whole)).toBeDefined()
        expect(
            compareKeyUnder({ ...DEFAULT_MATCHING, fuzzy: false })("gravite", "gravitee", whole)
        ).toBeUndefined()
    })

    it("matches no umlaut variant without umlautVariants", () => {
        expect(
            compareKeyUnder({ ...DEFAULT_MATCHING, umlautVariants: false })(
                "größe",
                "groesse",
                whole
            )
        ).toBeUndefined()
    })
})
