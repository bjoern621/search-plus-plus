import type { KeyPathFiles, VisitKeyPath } from "../api"
import { SearchAborted } from "./keyPathCollector"

const ABORT_CHECK_INTERVAL_NODES = 1024

/**
 * The nodes that one walk of a file visited, in the order of the walk.
 * Each node keeps the leading keys of the node before it and adds its own keys, so a deep path costs no copy per node.
 */
export interface KeyVisits {
    /** Per node: how many leading keys of the path before it it keeps. */
    kept: Int32Array
    /** Per node: how many keys of `addedKeys` it adds after the kept ones. */
    addedCounts: Int32Array
    /** The added keys of every node, node after node. */
    addedKeys: string[]
    starts: Int32Array
    ends: Int32Array
}

/** Walks `text` with `readKeys` and keeps every node that it visits. Throws `SearchAborted` once `signal` fires. */
export function recordKeyVisits(
    readKeys: KeyPathFiles["readKeys"],
    text: string,
    signal: AbortSignal
): KeyVisits {
    const kept: number[] = []
    const addedCounts: number[] = []
    const addedKeys: string[] = []
    const starts: number[] = []
    const ends: number[] = []
    const last: string[] = []
    readKeys(
        text,
        (path, start, end) => {
            if (starts.length % ABORT_CHECK_INTERVAL_NODES === 0 && signal.aborted) {
                throw new SearchAborted()
            }
            const shared = Math.min(last.length, path.length)
            let keep = 0
            while (keep < shared && last[keep] === path[keep]) keep++
            last.length = keep
            for (let index = keep; index < path.length; index++) {
                last.push(path[index]!)
                addedKeys.push(path[index]!)
            }
            kept.push(keep)
            addedCounts.push(path.length - keep)
            starts.push(start)
            ends.push(end)
        },
        signal
    )
    return {
        kept: Int32Array.from(kept),
        addedCounts: Int32Array.from(addedCounts),
        addedKeys,
        starts: Int32Array.from(starts),
        ends: Int32Array.from(ends)
    }
}

/** Visits the nodes of `visits` in the order that the walk met them, with the path that it passed. */
export function replayKeyVisits(visits: KeyVisits, visit: VisitKeyPath): void {
    const path: string[] = []
    let added = 0
    for (let node = 0; node < visits.starts.length; node++) {
        path.length = visits.kept[node]!
        for (let count = visits.addedCounts[node]!; count > 0; count--) {
            path.push(visits.addedKeys[added++]!)
        }
        visit(path, visits.starts[node]!, visits.ends[node]!)
    }
}
