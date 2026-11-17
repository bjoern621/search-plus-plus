import { highlightQuery, type Hint } from "../query"

/**
 * Draws the query in its highlight colors on a layer behind the input.
 * The input draws its own text transparent, so it keeps the caret, the selection and the native editing.
 */
export class QueryHighlight {
    private readonly content: HTMLElement
    private drawn: string | undefined

    constructor(
        private readonly input: HTMLInputElement,
        layer: HTMLElement
    ) {
        this.content = document.createElement("span")
        layer.replaceChildren(this.content)
        for (const type of ["input", "scroll", "keyup", "mouseup", "focus"])
            input.addEventListener(type, () => this.update())
        document.addEventListener("selectionchange", () => this.update())
        this.update()
    }

    /** Redraws after the text or the horizontal scroll of the input changed. Setting `input.value` from code needs this call, since it fires no event. */
    update(): void {
        const raw = this.input.value
        if (raw !== this.drawn) {
            this.drawn = raw
            this.content.replaceChildren(
                ...highlightQuery(raw).map((span) =>
                    part(span.kind, raw.slice(span.range.start, span.range.end))
                )
            )
        }
        this.content.style.transform = `translateX(${-this.input.scrollLeft}px)`
    }
}

function part(kind: string, text: string): HTMLElement {
    const element = document.createElement("span")
    element.className = `query-${kind}`
    element.textContent = text
    return element
}

/**
 * Shows `hint` in the hint line, or hides the line without one.
 * `blocked` marks a hint that stopped the search.
 * A hint with a suggested query turns into a button that hands the query to `run`.
 */
export function renderHint(
    element: HTMLElement,
    hint: Hint | undefined,
    blocked: boolean,
    run: (query: string) => void
): void {
    element.hidden = hint === undefined
    if (!hint) {
        element.replaceChildren()
        return
    }
    element.className = `hint ${blocked ? "blocked" : hint.tone}`
    const parts: HTMLElement[] = []
    if (hint.tone === "highlight") {
        const badge = document.createElement("span")
        badge.className = "hint-badge"
        badge.textContent = ".*"
        badge.setAttribute("aria-hidden", "true")
        parts.push(badge)
    }
    const suggested = hint.suggestedQuery
    if (suggested === undefined) {
        const text = document.createElement("span")
        text.textContent = hint.text
        parts.push(text)
    } else {
        const button = document.createElement("button")
        button.className = "hint-run"
        button.textContent = hint.text
        button.title = `Search for ${suggested}`
        button.addEventListener("click", () => run(suggested))
        parts.push(button)
    }
    element.replaceChildren(...parts)
}
