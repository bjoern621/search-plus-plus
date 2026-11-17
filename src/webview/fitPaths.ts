/** Maps a path element to the texts that it may show, the whole path first. */
const cutsOfElement = new WeakMap<Element, readonly string[]>()

/** A path that shows whole until `fitPaths` cuts it. `cuts` lists the texts that it may show, the whole path first. */
export function pathElement(className: string, cuts: readonly string[]): HTMLElement {
    const element = document.createElement("span")
    element.className = className
    const isolated = document.createElement("bdi")
    isolated.textContent = cuts[0] ?? ""
    element.append(isolated)
    cutsOfElement.set(element, cuts)
    return element
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
                cut: cuts.find((candidate) => textWidth(candidate, style.font) <= width)
            }
        ]
    })
    for (const { element, text, cut } of fitted) {
        if (cut === undefined) element.remove()
        else text.textContent = cut
    }
}

/**
 * Lists the ways to write the folders before a file name, such as `charts/apim/`, the whole path first.
 * Each cut drops one more folder, and a run of dropped folders shows as one `…`.
 * The folders that `kept` indexes drop last. The others drop from the front: `a/x/b/c/` keeping `x` cuts to `…/x/b/c/`, `…/x/…/c/`, `…/x/…/` and `…/`.
 */
export function folderCuts(folders: string, kept: readonly number[] = []): string[] {
    const names = folders.split("/")
    const order = names
        .map((_, index) => index)
        .sort((a, b) => Number(kept.includes(a)) - Number(kept.includes(b)) || a - b)
    const dropped = new Set<number>()
    const cuts = [`${folders}/`]
    for (const index of order) {
        dropped.add(index)
        cuts.push(writeCut(names, dropped))
    }
    return cuts
}

function writeCut(names: readonly string[], dropped: ReadonlySet<number>): string {
    const parts = names.flatMap((name, index) => {
        if (!dropped.has(index)) return [name]
        return dropped.has(index - 1) ? [] : ["…"]
    })
    return `${parts.join("/")}/`
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
