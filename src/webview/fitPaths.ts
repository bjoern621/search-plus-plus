import type { Range } from "../search/types"

/** A text that a path may show, with the ranges of `text` that the query matched. */
export interface PathCut {
    text: string
    ranges: readonly Range[]
}

/** Maps a path element to the texts that it may show, the whole path first. */
const cutsOfElement = new WeakMap<Element, readonly PathCut[]>()

/** A path that shows whole until `fitPaths` cuts it. `cuts` lists the texts that it may show, the whole path first. */
export function pathElement(className: string, cuts: readonly PathCut[]): HTMLElement {
    const element = document.createElement("span")
    element.className = className
    const isolated = document.createElement("bdi")
    fillMarked(isolated, cuts[0] ?? { text: "", ranges: [] })
    element.append(isolated)
    cutsOfElement.set(element, cuts)
    return element
}

/** Fills `element` with `cut.text` and marks its ranges as matched names. */
export function fillMarked(element: Element, cut: PathCut): void {
    element.replaceChildren()
    let cursor = 0
    for (const range of [...cut.ranges].sort((a, b) => a.start - b.start)) {
        const start = Math.max(range.start, cursor)
        if (range.end <= start) continue
        if (start > cursor) element.append(cut.text.slice(cursor, start))
        const mark = document.createElement("span")
        mark.className = "name-mark"
        mark.textContent = cut.text.slice(start, range.end)
        element.append(mark)
        cursor = range.end
    }
    if (cursor < cut.text.length) element.append(cut.text.slice(cursor))
}

/**
 * Cuts each path in `elements` that overflows its box to the first of its cuts that fits the box.
 * A path whose last cut fails to fit leaves the page.
 * Reads every box before it writes a text, so the page lays out once for all of them.
 */
export function fitPaths(elements: Iterable<HTMLElement>): void {
    const fitted = [...elements].flatMap((element) => {
        const text = element.firstElementChild
        const cuts = cutsOfElement.get(element)
        if (!text || !cuts || element.scrollWidth <= element.clientWidth) return []
        const style = getComputedStyle(element)
        // The box takes fractions of a pixel, which clientWidth rounds away.
        const width =
            element.getBoundingClientRect().width -
            parseFloat(style.paddingLeft) -
            parseFloat(style.paddingRight)
        return [
            {
                element,
                text,
                cut: cuts.find((candidate) => textWidth(candidate.text, style.font) <= width)
            }
        ]
    })
    for (const { element, text, cut } of fitted) {
        if (cut === undefined) element.remove()
        else fillMarked(text, cut)
    }
}

/**
 * Lists the ways to write the folders before a file name, such as `charts/apim/`, the whole path first.
 * Each cut drops one more folder, and a run of dropped folders shows as one `…`.
 * The folders that `kept` indexes drop last. The others drop from the front: `a/x/b/c/` keeping `x` cuts to `…/x/b/c/`, `…/x/…/c/`, `…/x/…/` and `…/`.
 * `ranges` mark matched names in `folders`. Each cut keeps the marks of the folders that it shows.
 */
export function folderCuts(
    folders: string,
    kept: readonly number[] = [],
    ranges: readonly Range[] = []
): PathCut[] {
    const names = folders.split("/")
    const order = names
        .map((_, index) => index)
        .sort((a, b) => Number(kept.includes(a)) - Number(kept.includes(b)) || a - b)
    const dropped = new Set<number>()
    const cuts = [writeCut(names, dropped, ranges)]
    for (const index of order) {
        dropped.add(index)
        cuts.push(writeCut(names, dropped, ranges))
    }
    return cuts
}

function writeCut(
    names: readonly string[],
    dropped: ReadonlySet<number>,
    ranges: readonly Range[]
): PathCut {
    let text = ""
    let nameStart = 0
    const marks: Range[] = []
    names.forEach((name, index) => {
        const nameEnd = nameStart + name.length
        if (!dropped.has(index)) {
            const shift = text.length - nameStart
            for (const range of ranges) {
                const start = Math.max(range.start, nameStart)
                const end = Math.min(range.end, nameEnd)
                if (end > start) marks.push({ start: start + shift, end: end + shift })
            }
            text += `${name}/`
        } else if (!dropped.has(index - 1)) text += "…/"
        nameStart = nameEnd + 1
    })
    return { text, ranges: marks }
}

let canvas: CanvasRenderingContext2D | undefined
/** Maps a font and a text, joined by a line break, to the width of the text in pixels. Grows with each path cut. */
const measuredWidths = new Map<string, number>()

/** Measures on a canvas, since laying out each candidate in the page would cost a layout per candidate. */
function textWidth(text: string, font: string): number {
    const key = `${font}\n${text}`
    const known = measuredWidths.get(key)
    if (known !== undefined) return known
    canvas ??= document.createElement("canvas").getContext("2d") ?? undefined
    if (!canvas) return Number.POSITIVE_INFINITY
    canvas.font = font
    const width = canvas.measureText(text).width
    measuredWidths.set(key, width)
    return width
}
