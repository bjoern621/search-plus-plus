import { describe, expect, it } from "vitest"
import type { KeyPathFiles } from "../../src/api"
import { SearchAborted } from "../../src/structural/keyPathCollector"
import { recordKeyVisits, replayKeyVisits } from "../../src/structural/keyVisits"

type Visit = [string[], number, number]

/** Visits the given nodes and reuses one path array, as a walker may. */
function readerOf(visits: Visit[]): KeyPathFiles["readKeys"] {
    return (_text, visit) => {
        const path: string[] = []
        for (const [keys, start, end] of visits) {
            path.length = 0
            path.push(...keys)
            visit(path, start, end)
        }
    }
}

function replayed(visits: Visit[]): Visit[] {
    const seen: Visit[] = []
    const recorded = recordKeyVisits(readerOf(visits), "", new AbortController().signal)
    replayKeyVisits(recorded, (path, start, end) => seen.push([[...path], start, end]))
    return seen
}

describe("recordKeyVisits", () => {
    it("replays every node in the order of the walk", () => {
        const visits: Visit[] = [
            [["a"], 0, 1],
            [["a", "b"], 2, 3],
            [["a", "b", "c"], 4, 5],
            [["a", "d"], 6, 7],
            [[], 8, 8],
            [["e", "b", "c"], 9, 10],
            [["e", "b", "c"], 11, 12],
            [["a"], 13, 14]
        ]
        expect(replayed(visits)).toEqual(visits)
    })

    it("replays a file without nodes as no visit", () => {
        expect(replayed([])).toEqual([])
    })

    it("throws SearchAborted once the signal fires", () => {
        const controller = new AbortController()
        controller.abort()
        expect(() => recordKeyVisits(readerOf([[["a"], 0, 1]]), "", controller.signal)).toThrow(
            SearchAborted
        )
    })
})
