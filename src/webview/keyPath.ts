import type { ResultLine } from "../messages"
import { pathElement } from "./fitPaths"

/** The keys of the key path that the row of `line` shows after its text. Undefined for a line without one. */
export function shownKeys(line: ResultLine): readonly string[] | undefined {
    return line.showKeyPath && line.keyPath ? line.keyPath : undefined
}

/** Writes a key path as a query that finds it: keys joined with dots, a key holding a dot, an operator or a space in quotes. */
export function keyPathText(keys: readonly string[]): string {
    return keys.map(keyText).join(".")
}

function keyText(key: string): string {
    return /[.\\"*?[\]{},\s]/.test(key) ? `"${key.replace(/["\\]/g, (char) => `\\${char}`)}"` : key
}

/**
 * The key path after the line text, whole until `fitPaths` cuts it.
 * A path too wide drops whole keys from its second key on.
 * An ellipsis between thin spaces takes the place of the dropped keys and the dots around them: `gateway … limits.memory`.
 * The first and the last key stay, until even the first key leaves too little room: `…memory`.
 * The path leaves the page once the last key alone fails to fit.
 */
export function keyPathElement(keys: readonly string[]): HTMLElement {
    return pathElement("key-path", keyPathCuts(keys))
}

/** Lists the ways to write `keys`, the whole path first and the last key alone last. */
function keyPathCuts(keys: readonly string[]): string[] {
    const texts = keys.map(keyText)
    const cuts = [texts.join(".")]
    for (let kept = 2; kept < texts.length; kept++)
        cuts.push(`${texts[0]}\u2009…\u2009${texts.slice(kept).join(".")}`)
    if (texts.length > 1) cuts.push(`…${texts.at(-1)}`)
    return cuts
}
