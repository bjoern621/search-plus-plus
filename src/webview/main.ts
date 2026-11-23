import type {
    FileResult,
    HostMessage,
    OpenOptions,
    ResultLine,
    ResultsLayout,
    SearchStatus,
    ViewMessage,
    ViewSettings
} from "../messages"
import { hintFor, parseQuery, type Hint } from "../query"
import { type FileFields, PathFilter } from "../search/globs"
import { appendEntry, fileEntry, folderEntry, onlyAdded } from "./exclusions"
import { ContextMenu } from "./contextMenu"
import { firstFocusableRow, type KeyPress, rowCommand } from "./keyboard"
import { matchMenu, type MenuAction } from "./menu"
import { FileIconTheme } from "./fileIcons"
import { QueryHighlight, renderHint } from "./queryInput"
import { highlightParts, resultSummary, ResultTree, type Row, rowAt, rowOffsets } from "./tree"
import { keyPathElement, shownKeys } from "./keyPath"
import { fitPaths, folderCuts, pathElement } from "./fitPaths"
import { EXCLUDE_ICON } from "./filledIcons"
import {
    continuesGroup,
    cutToMatch,
    dedent,
    groupAround,
    groupDedents,
    targetLine
} from "./codeLines"

interface ViewState extends FileFields {
    query: string
    history: string[]
    fileFieldsOpen: boolean
}

declare function acquireVsCodeApi(): {
    postMessage(message: ViewMessage): void
    getState(): ViewState | undefined
    setState(state: ViewState): void
}

const HISTORY_LIMIT = 50
/** Rows rendered above and below the visible ones, so fast scrolling shows no gaps. */
const OVERSCAN_ROWS = 20
/** A search adds its query to the history once no other search replaced it for this long, as in the built-in Search view. */
const HISTORY_DELAY_MS = 2000

const vscode = acquireVsCodeApi()
document.documentElement.dataset.platform = editorPlatform(navigator.userAgent)
const input = document.getElementById("query") as HTMLInputElement
const queryHighlight = new QueryHighlight(
    input,
    document.getElementById("query-highlight") as HTMLDivElement
)
const hint = document.getElementById("hint") as HTMLDivElement
const detailsButton = document.getElementById("details") as HTMLButtonElement
const fileFieldsElement = document.getElementById("file-fields") as HTMLDivElement
const includeInput = document.getElementById("include") as HTMLInputElement
const excludeInput = document.getElementById("exclude") as HTMLInputElement
const summaryText = document.getElementById("summary") as HTMLDivElement
const results = document.getElementById("results") as HTMLDivElement
const rowsElement = document.getElementById("rows") as HTMLDivElement
const contextMenu = new ContextMenu(
    document.getElementById("menu") as HTMLDivElement,
    runMenuAction,
    () => results.focus()
)

const tree = new ResultTree()
const iconTheme = new FileIconTheme()
/** Keys of the collapsed folder and file rows. */
const collapsed = new Set<string>()
let searchId = 0
let status: SearchStatus | "running" | "idle" = "idle"
let cappedAt: number | undefined
let rows: Row[] = []
let offsets: number[] = [0]
/** Per row, the columns of indentation that a code line drops. */
let dedents: number[] = []
let layoutStale = false
let frame = 0
/** The hint of the host that stopped the last search. It replaces the hint on the typed query until the text changes. */
let blockedHint: Hint | undefined
/** The query and fields of the last search, so a change of the fields can repeat it. */
let searched: ({ query: string } & FileFields) | undefined
/** The settings of the workbench that the view follows, with their defaults until the host sends them. */
let settings: ViewSettings = { treeIndentPx: 8, searchOnType: true, searchOnTypeDebounceMs: 300 }
/** The layout that the host keeps for the workspace, with the default until the host sends it. */
let resultsLayout: ResultsLayout = "list"
let typingTimer = 0
let historyTimer = 0
/** Index of the row that holds the keyboard focus inside the results, -1 without one. */
let focusedIndex = -1
/** Index of the row under the pointer, -1 without one. */
let hoveredIndex = -1
/** The line that a click or Enter opened last and the index of the range that the editor selected. Another activation of it opens the next range. */
let openedMatch: { line: ResultLine; match: number } | undefined
/** The line whose context menu shows. */
let menuRow: Extract<Row, { kind: "line" }> | undefined
/** The scroll position at which the context menu opened. A scroll event that leaves it unchanged keeps the menu open. */
let menuScrollTop = 0

const state: ViewState = {
    query: "",
    history: [],
    include: "",
    exclude: "",
    fileFieldsOpen: false,
    ...vscode.getState()
}
includeInput.value = state.include
excludeInput.value = state.exclude
/** Position in the history while Up and Down walk it. `history.length` stands for the text being typed. */
let historyIndex = state.history.length
setQuery(state.query)
setFileFieldsOpen(state.fileFieldsOpen)
renderSummary()

input.addEventListener("keydown", (event) => {
    if (moveBetweenFields(event)) {
        event.preventDefault()
        return
    }
    switch (event.key) {
        case "Enter":
            submit()
            return
        case "ArrowUp":
        case "ArrowDown":
            event.preventDefault()
            walkHistory(event.key === "ArrowUp" ? -1 : 1)
            return
    }
})

input.addEventListener("input", () => {
    blockedHint = undefined
    refreshHint()
    saveState()
    searchOnType()
})

detailsButton.addEventListener("click", () => setFileFieldsOpen(fileFieldsElement.hidden))

for (const button of document.querySelectorAll<HTMLButtonElement>(".clear")) {
    button.addEventListener("click", () =>
        clearInput(document.getElementById(button.dataset.clears ?? "") as HTMLInputElement)
    )
}

for (const field of [includeInput, excludeInput]) {
    field.addEventListener("keydown", (event) => {
        if (moveBetweenFields(event)) event.preventDefault()
        else if (event.key === "Enter") submit()
    })
    field.addEventListener("input", () => applyFileFields())
}

rowsElement.addEventListener("click", (event) => {
    const excludeButton = (event.target as HTMLElement).closest<HTMLElement>(".exclude")
    if (excludeButton) {
        exclude(excludeButton.dataset.entry ?? "")
        return
    }
    const index = rowIndexFromEvent(event)
    if (!rows[index]) return
    focusRow(index)
    // The second click of a double-click keeps the match that the first one opened.
    activate(index, { preview: true, preserveFocus: false }, event.detail <= 1)
})

// The class "keyboard-focus" shows the selection outline after a key press in the results and hides it on a click.
// Focus that arrives from the keyboard, such as Tab from the query field, shows the outline at once.
let lastInputFromKeyboard = false
document.addEventListener("keydown", () => (lastInputFromKeyboard = true), true)
document.addEventListener(
    "pointerdown",
    () => {
        lastInputFromKeyboard = false
        results.classList.remove("keyboard-focus")
    },
    true
)
results.addEventListener("focus", () =>
    results.classList.toggle("keyboard-focus", lastInputFromKeyboard)
)

// Switching to the view from the workbench, such as through the activity bar, selects the query, so typing starts a new search.
// A click into the view keeps the focus where the click puts it. Its pointerdown can follow the focus event, so the check waits a frame.
let pointerDownSinceWindowFocus = false
document.addEventListener("pointerdown", () => (pointerDownSinceWindowFocus = true), true)
window.addEventListener("focus", () => {
    pointerDownSinceWindowFocus = false
    requestAnimationFrame(() => {
        if (!pointerDownSinceWindowFocus) selectQuery()
    })
})

results.addEventListener("keydown", (event) => {
    if (event.target !== results) return
    results.classList.add("keyboard-focus")
    if (handleRowKey(event)) event.preventDefault()
})

rowsElement.addEventListener("dblclick", (event) => {
    const index = rowIndexFromEvent(event)
    if (rows[index]?.kind === "line")
        activate(index, { preview: false, preserveFocus: false }, false)
})

rowsElement.addEventListener("contextmenu", (event) => {
    if (openMenu(rowIndexFromEvent(event), false)) event.preventDefault()
})

rowsElement.addEventListener("mouseover", (event) => {
    // The render that focuses the row of an opening menu puts a new element under the pointer, which fires a mouseover.
    if (contextMenu.isOpen) return
    hoverRow(rowIndexFromEvent(event))
})

results.addEventListener("mouseleave", () => hoverRow(-1))

// The context menu key fires a contextmenu event on the results after the keydown that opened the menu.
results.addEventListener("contextmenu", (event) => {
    if (event.target === results) event.preventDefault()
})

results.addEventListener("scroll", () => {
    if (results.scrollTop !== menuScrollTop) contextMenu.close(false)
    scheduleRender()
})
new ResizeObserver(() => scheduleRender()).observe(results)

window.addEventListener("message", (event: MessageEvent<HostMessage>) => {
    const message = event.data
    switch (message.type) {
        case "focus":
            selectQuery()
            return
        case "searchAgain":
            if (searched && searched.query !== "")
                vscode.postMessage({ type: "search", ...searched })
            return
        case "settings":
            settings = message.settings
            rowsElement.style.setProperty("--tree-indent", `${message.settings.treeIndentPx}px`)
            return
        case "resultsLayout":
            setResultsLayout(message.layout)
            return
        case "searchStarted":
            startSearch(message.searchId)
            return
        case "results":
            if (message.searchId !== searchId) return
            tree.add(message.files)
            invalidateLayout()
            return
        case "hint":
            if (message.searchId !== searchId) return
            blockedHint = message.hint
            refreshHint()
            return
        case "icons":
            iconTheme.set(message.theme)
            tree.setIcons(message.files)
            invalidateLayout()
            return
        case "searchDone":
            if (message.searchId !== searchId) return
            status = message.status
            cappedAt = message.status === "capped" ? message.limit : undefined
            invalidateLayout()
            return
    }
})

vscode.postMessage({ type: "ready" })

function submit(): void {
    const query = input.value
    searchWithFields(query)
    remember(query)
}

/** Adds `query` to the end of the history, once. */
function remember(query: string): void {
    window.clearTimeout(historyTimer)
    if (query !== "" && state.history.at(-1) !== query)
        state.history = [...state.history, query].slice(-HISTORY_LIMIT)
    historyIndex = state.history.length
    saveState()
}

/** Searches for `query` at once. A search that no other search replaces for a while adds its query to the history. */
function searchWithFields(query: string): void {
    window.clearTimeout(typingTimer)
    const fields: FileFields = { include: includeInput.value, exclude: excludeInput.value }
    searched = { query, ...fields }
    vscode.postMessage({ type: "search", query, ...fields })
    window.clearTimeout(historyTimer)
    historyTimer = window.setTimeout(() => remember(query), HISTORY_DELAY_MS)
}

/**
 * Searches for the query once typing pauses, as the built-in Search view does under `search.searchOnType`.
 * The keystroke cancels the search that runs, since its results no longer fit the fields.
 */
function searchOnType(): void {
    window.clearTimeout(typingTimer)
    if (!settings.searchOnType) return
    vscode.postMessage({ type: "cancelSearch" })
    typingTimer = window.setTimeout(
        () => searchWithFields(input.value),
        settings.searchOnTypeDebounceMs
    )
}

/**
 * Follows a change of the files to include and exclude fields.
 * A change that only adds exclusions hides their results at once.
 * Any other change searches once typing pauses, since it can bring back files that the last search left out.
 */
function applyFileFields(): void {
    saveState()
    const fields: FileFields = { include: includeInput.value, exclude: excludeInput.value }
    if (
        searched &&
        fields.include === searched.include &&
        onlyAdded(searched.exclude, fields.exclude)
    ) {
        tree.setFilter(new PathFilter(fields))
        invalidateLayout()
        return
    }
    searchOnType()
}

/** Adds `entry` to files to exclude and drops its results without a new search. */
function exclude(entry: string): void {
    excludeInput.value = appendEntry(excludeInput.value, entry)
    setFileFieldsOpen(true)
    applyFileFields()
}

function setFileFieldsOpen(open: boolean): void {
    fileFieldsElement.hidden = !open
    detailsButton.classList.toggle("active", open)
    detailsButton.setAttribute("aria-expanded", String(open))
    state.fileFieldsOpen = open
    saveState()
}

/**
 * Moves the focus with Ctrl+Down and Ctrl+Up, or Cmd on macOS, as the built-in Search view does.
 * Ctrl+Down goes from the query to files to include and files to exclude while they show, then into the results.
 * Ctrl+Up goes back from files to exclude to the query.
 * Returns false for any other key.
 */
function moveBetweenFields(event: KeyboardEvent): boolean {
    if (!(event.ctrlKey || event.metaKey) || (event.key !== "ArrowDown" && event.key !== "ArrowUp"))
        return false
    const fields = fileFieldsElement.hidden ? [input] : [input, includeInput, excludeInput]
    const index = fields.indexOf(event.target as HTMLInputElement)
    if (index < 0) return false
    if (event.key === "ArrowUp") {
        const previous = fields[index - 1]
        if (!previous) return false
        previous.focus()
        previous.select()
        return true
    }
    const next = fields[index + 1]
    if (next) {
        next.focus()
        next.select()
        return true
    }
    focusResults()
    return true
}

/** Moves the keyboard focus into the results, onto the first row unless a row holds it already. */
function focusResults(): void {
    layout()
    results.focus()
    if (focusedIndex < 0 && rows.length > 0) focusRow(firstFocusableRow(rows))
}

function walkHistory(step: -1 | 1): void {
    const next = historyIndex + step
    if (next < 0 || next > state.history.length) return
    historyIndex = next
    setQuery(state.history[next] ?? "")
    searchOnType()
}

/** Puts `query` into the input as if typed. */
function setQuery(query: string): void {
    input.value = query
    blockedHint = undefined
    queryHighlight.update()
    refreshHint()
    saveState()
}

function runSuggestedQuery(query: string): void {
    setQuery(query)
    input.focus()
    submit()
}

/** Empties the input and handles it as typing would, so the query or the file fields search again. */
function clearInput(field: HTMLInputElement): void {
    field.value = ""
    field.focus()
    field.dispatchEvent(new Event("input"))
}

function selectQuery(): void {
    input.focus()
    input.select()
}

function saveState(): void {
    state.query = input.value
    state.include = includeInput.value
    state.exclude = excludeInput.value
    vscode.setState(state)
}

function startSearch(id: number): void {
    searchId = id
    status = "running"
    cappedAt = undefined
    tree.clear()
    collapsed.clear()
    focusedIndex = -1
    results.removeAttribute("aria-activedescendant")
    results.scrollTop = 0
    blockedHint = undefined
    refreshHint()
    invalidateLayout()
}

function refreshHint(): void {
    renderHint(
        hint,
        blockedHint ?? hintFor(parseQuery(input.value)),
        blockedHint !== undefined,
        runSuggestedQuery
    )
}

function invalidateLayout(): void {
    layoutStale = true
    scheduleRender()
}

function scheduleRender(): void {
    if (frame !== 0) return
    frame = requestAnimationFrame(() => {
        frame = 0
        render()
    })
}

function layout(): void {
    if (!layoutStale) return
    layoutStale = false
    rows = tree.rows(collapsed, resultsLayout)
    offsets = rowOffsets(rows)
    dedents = groupDedents(rows)
    if (focusedIndex >= rows.length) focusedIndex = rows.length - 1
    rowsElement.style.height = `${offsets.at(-1) ?? 0}px`
    const widest = rows.reduce(
        (max, row) => (row.kind === "line" ? Math.max(max, row.line.line + 1) : max),
        0
    )
    rowsElement.style.setProperty("--line-number-width", `${Math.max(2, String(widest).length)}ch`)
    renderSummary()
}

/** Lays the rows out in `next`. The focus stays on its row, unless `next` shows no such row, as for a folder row in the list. */
function setResultsLayout(next: ResultsLayout): void {
    if (next === resultsLayout) return
    const focused = rows[focusedIndex]
    resultsLayout = next
    layoutStale = true
    layout()
    hoveredIndex = -1
    focusedIndex = focused ? rows.findIndex((row) => sameRow(row, focused)) : -1
    if (focusedIndex < 0) {
        results.removeAttribute("aria-activedescendant")
    } else {
        results.setAttribute("aria-activedescendant", `row-${focusedIndex}`)
        scrollRowIntoView(focusedIndex)
    }
    scheduleRender()
}

/** Says whether two rows of different layouts show the same folder, file or code line. */
function sameRow(a: Row, b: Row): boolean {
    if (a.kind === "line" && b.kind === "line")
        return a.file.uri === b.file.uri && a.line.line === b.line.line
    if (a.kind === "line" || b.kind === "line") return false
    return a.key === b.key
}

function renderSummary(): void {
    summaryText.textContent = summaryFor() ?? ""
}

function summaryFor(): string | undefined {
    switch (status) {
        case "idle":
        case "empty":
        case "blocked":
            return undefined
        case "noFolder":
            return "Open a folder or a file to search it."
        case "failed":
            return "The search could not finish. Open the Search++ output for the reason."
        case "running":
            return tree.matchCount === 0
                ? undefined
                : resultSummary(tree.matchCount, tree.fileCount)
        case "complete":
            return resultSummary(tree.matchCount, tree.fileCount)
        case "capped":
            return resultSummary(tree.matchCount, tree.fileCount, cappedAt)
    }
}

/** Renders the rows in view. The others stay out of the page, so thousands of results scroll smoothly. */
function render(): void {
    layout()
    const top = results.scrollTop
    const first = Math.max(0, rowAt(offsets, top) - OVERSCAN_ROWS)
    const last = Math.min(
        rows.length,
        rowAt(offsets, top + results.clientHeight) + OVERSCAN_ROWS + 1
    )
    const elements: HTMLElement[] = []
    for (let index = first; index < last; index++) {
        const row = rows[index]
        if (row) elements.push(rowElement(row, index))
    }
    rowsElement.replaceChildren(...elements, hoveredOutline, focusedOutline)
    placeOutline(hoveredOutline, hoveredIndex)
    placeOutline(focusedOutline, focusedIndex)
    fitMatchLines()
    fitPaths(rowsElement.querySelectorAll<HTMLElement>(".key-path, .folder-path"))
}

function rowElement(row: Row, index: number): HTMLElement {
    const element = document.createElement("div")
    element.dataset.index = String(index)
    element.id = `row-${index}`
    element.style.top = `${offsets[index] ?? 0}px`
    element.setAttribute("role", "treeitem")
    switch (row.kind) {
        case "folder":
            element.classList.add("row")
            element.setAttribute("aria-expanded", String(!row.collapsed))
            element.style.setProperty("--depth", String(row.depth))
            element.title = row.label
            const icon = iconTheme.folderElement(row.icon)
            element.append(twisty(row.collapsed), ...(icon ? [icon] : []), span("label", row.label))
            if (row.folder !== "")
                element.append(
                    excludeButton(`Exclude folder ${row.folder}`, folderEntry(row.folder))
                )
            return element
        case "file": {
            element.classList.add("row")
            element.setAttribute("aria-expanded", String(!row.collapsed))
            element.style.setProperty("--depth", String(row.depth))
            element.title = [row.file.root, row.file.folder, row.file.name]
                .filter((part) => part !== "")
                .join("/")
            element.append(twisty(row.collapsed), iconTheme.element(row.file.icons?.file))
            if (resultsLayout === "tree") {
                element.append(span("label", row.file.name))
                if (row.folders !== "") element.append(span("description", row.folders))
            } else {
                if (row.folders !== "")
                    element.append(
                        pathElement(
                            "folder-path dimmed",
                            folderCuts(row.folders, row.distinctFolders)
                        )
                    )
                element.append(span("label", row.file.name))
            }
            element.append(excludeButton(`Exclude ${row.file.name}`, fileEntry(row.file)))
            return element
        }
        case "line": {
            element.classList.add("line")
            if (row.line.match) element.classList.add("match")
            if (skipsLines(index)) element.classList.add("after-gap")
            const text = span("text", "")
            fillLineText(text, dedent(row.line, dedents[index] ?? 0), openedMatchOf(row.line))
            element.append(
                span("number", String(row.line.line + 1)),
                span("cut-mark", row.line.offset > 0 ? "…" : ""),
                text
            )
            // The count starts at its widest, so the text that `fitMatchLines` measures never grows back over it.
            if (row.line.ranges.length > 1)
                element.append(span("more-matches", `+${row.line.ranges.length - 1}`))
            const keys = shownKeys(row.line)
            if (keys) element.append(keyPathElement(keys))
            return element
        }
    }
}

/** Fills `text` with the line and marks its ranges. The range at index `opened` gets the look of the selected match in the editor. */
function fillLineText(text: HTMLElement, line: ResultLine, opened: number | undefined): void {
    text.replaceChildren()
    for (const part of highlightParts(line)) {
        if (part.match === undefined) {
            text.append(part.text)
            continue
        }
        const mark = span(part.match === opened ? "mark opened" : "mark", part.text, "mark")
        mark.dataset.match = String(part.match)
        text.append(mark)
    }
}

/** The index of the range that the editor selected last in `line`, undefined for any other line. */
function openedMatchOf(line: ResultLine): number | undefined {
    return openedMatch?.line === line ? openedMatch.match : undefined
}

/**
 * Fits each match line in view to its row: the line shows the range that the editor selected last, else its first one.
 * A count after the text gives the number of matches that stay out of view. A line that shows every match loses the count.
 * A resize renders again and fits anew.
 */
function fitMatchLines(): void {
    for (const element of rowsElement.querySelectorAll<HTMLElement>(".line.match")) {
        const text = element.querySelector<HTMLElement>(".text")
        const index = Number(element.dataset.index)
        const row = rows[index]
        if (!text || row?.kind !== "line") continue
        const opened = openedMatchOf(row.line)
        cutToShownMatch(element, text, row.line, dedents[index] ?? 0, opened)
        countHiddenMatches(element, text, row.line)
    }
}

/** Cuts the start of the line when the range it shows ends past the edge of the row. */
function cutToShownMatch(
    element: HTMLElement,
    text: HTMLElement,
    line: ResultLine,
    dedentColumns: number,
    opened: number | undefined
): void {
    const shown = opened ?? 0
    const mark = text.querySelector<HTMLElement>(`.mark[data-match="${shown}"]`)
    const anyMark = mark ?? text.querySelector<HTMLElement>(".mark")
    if (!anyMark?.textContent) return
    if (mark && mark.getBoundingClientRect().right <= text.getBoundingClientRect().right + 0.5)
        return
    const markBox = anyMark.getBoundingClientRect()
    const charWidth = markBox.width / anyMark.textContent.length
    const cut = cutToMatch(
        dedent(line, dedentColumns),
        Math.floor(text.clientWidth / charWidth),
        shown
    )
    if (!cut) return
    fillLineText(text, cut, opened)
    const cutMark = element.querySelector<HTMLElement>(".cut-mark")
    if (cutMark) cutMark.textContent = "…"
}

/** Writes the number of ranges that the row leaves out of view or cuts at an edge into the count, or removes the count when every range shows. */
function countHiddenMatches(element: HTMLElement, text: HTMLElement, line: ResultLine): void {
    const count = element.querySelector<HTMLElement>(".more-matches")
    if (!count) return
    const box = text.getBoundingClientRect()
    let shown = 0
    for (const mark of text.querySelectorAll<HTMLElement>(".mark")) {
        const markBox = mark.getBoundingClientRect()
        if (markBox.left >= box.left - 0.5 && markBox.right <= box.right + 0.5) shown++
    }
    const hidden = line.ranges.length - shown
    if (hidden === 0) {
        count.remove()
        return
    }
    count.textContent = `+${hidden}`
    count.title =
        hidden === 1
            ? "1 more match in this line. Click the line again to open the next match."
            : `${hidden} more matches in this line. Click the line again to open the next match.`
}

/** True for a code line that starts a group below another code line of the same file. */
function skipsLines(index: number): boolean {
    const row = rows[index]
    const above = rows[index - 1]
    if (row?.kind !== "line" || above?.kind !== "line" || above.file !== row.file) return false
    return !continuesGroup(above, row)
}

/** One rounded outline around the group of the hovered row, one around the group of the focused row. */
const hoveredOutline = outlineElement("hovered")
const focusedOutline = outlineElement("focused")

function outlineElement(kind: string): HTMLDivElement {
    const element = document.createElement("div")
    element.className = `group-outline ${kind}`
    element.hidden = true
    return element
}

/**
 * Finds the rows that hover and selection mark together.
 * A folder or file takes the rows inside it. A code line takes its group, meaning the rows between two dividers.
 */
function groupOf(index: number): { first: number; last: number } | undefined {
    const row = rows[index]
    if (!row) return undefined
    if (row.kind === "line") return groupAround(rows, index)
    let last = index
    while (last + 1 < rows.length && (rows[last + 1]?.depth ?? 0) > row.depth) last++
    return { first: index, last }
}

function placeOutline(outline: HTMLElement, index: number): void {
    const group = groupOf(index)
    outline.hidden = group === undefined
    if (!group) return
    const top = offsets[group.first] ?? 0
    // The divider of a gap below the group sits 1px below its last row. The outline covers it, so the two lines draw as one.
    const coverDivider = skipsLines(group.last + 1) ? 1 : 0
    outline.style.top = `${top}px`
    outline.style.height = `${(offsets[group.last + 1] ?? top) - top + coverDivider}px`
}

/** Moves the hover outline to the group of the row under the pointer, without a render. */
function hoverRow(index: number): void {
    if (index === hoveredIndex) return
    hoveredIndex = index
    placeOutline(hoveredOutline, index)
}

/** A button that adds `entry` to files to exclude, drawn as a circle with a slash. */
function excludeButton(label: string, entry: string): HTMLButtonElement {
    const button = document.createElement("button")
    button.className = "icon exclude"
    button.tabIndex = -1
    button.title = label
    button.setAttribute("aria-label", label)
    button.dataset.entry = entry
    button.innerHTML = EXCLUDE_ICON
    return button
}

/** A chevron that points down below an expanded row and right beside a collapsed one, as the twisties of the workbench trees. */
function twisty(collapsed: boolean): HTMLElement {
    const element = codicon(collapsed ? "chevron-right" : "chevron-down")
    element.classList.add("twisty")
    return element
}

function codicon(name: string): HTMLElement {
    const element = document.createElement("span")
    element.className = `codicon codicon-${name}`
    element.setAttribute("aria-hidden", "true")
    return element
}

function span(className: string, text: string, tag: "span" | "mark" = "span"): HTMLElement {
    const element = document.createElement(tag)
    element.className = className
    element.textContent = text
    return element
}

/** Returns the index of the row under the event, -1 outside of every row. */
function rowIndexFromEvent(event: Event): number {
    const element = (event.target as HTMLElement).closest<HTMLElement>("[data-index]")
    return element ? Number(element.dataset.index) : -1
}

/** Runs the command of a key pressed on the results. Returns false for a key without a command, so the browser handles it. */
function handleRowKey(press: KeyPress): boolean {
    const command = rowCommand(rows, focusedIndex, press)
    if (!command) return false
    switch (command.kind) {
        case "focus":
            focusRow(command.index)
            return true
        case "activate":
            activate(focusedIndex, command.open)
            return true
        case "toggle":
            activate(focusedIndex, { preview: true, preserveFocus: true })
            return true
        case "menu":
            openMenu(focusedIndex, true)
            return true
    }
}

/** Moves the keyboard focus to the row at `index` and scrolls it into view. */
function focusRow(index: number): void {
    focusedIndex = index
    layout()
    scrollRowIntoView(index)
    results.setAttribute("aria-activedescendant", `row-${index}`)
    render()
}

/** Scrolls the results by the least distance that brings the row at `index` into view. */
function scrollRowIntoView(index: number): void {
    const top = offsets[index] ?? 0
    const bottom = offsets[index + 1] ?? top
    if (top < results.scrollTop) results.scrollTop = top
    else if (bottom > results.scrollTop + results.clientHeight)
        results.scrollTop = bottom - results.clientHeight
}

/** Opens the context menu of the matched line at `index`. Returns false for any other row. */
/** A context line opens the menu of the matched line of its group, as a click on it opens that match. */
function openMenu(clickedIndex: number, fromKeyboard: boolean): boolean {
    const index = targetRowIndex(clickedIndex)
    const row = rows[index]
    if (row?.kind !== "line" || !row.line.match) return false
    focusRow(index)
    const element = rowsElement.querySelector<HTMLElement>(`[data-index="${index}"]`)
    if (!element) return false
    menuRow = row
    menuScrollTop = results.scrollTop
    contextMenu.open(
        matchMenu(row.file, row.line, searched?.query ?? input.value),
        element.getBoundingClientRect(),
        fromKeyboard
    )
    return true
}

function targetRowIndex(index: number): number {
    const row = rows[index]
    if (row?.kind !== "line") return index
    const target = targetLine(rows, index)
    const found = rows.findIndex(
        (candidate) =>
            candidate.kind === "line" && candidate.file === row.file && candidate.line === target
    )
    return found === -1 ? index : found
}

function runMenuAction(action: MenuAction): void {
    switch (action.kind) {
        case "search":
            setQuery(action.query)
            submit()
            return
        case "exclude":
            exclude(action.entry)
            return
        case "copyLine":
            if (menuRow)
                vscode.postMessage({
                    type: "copyLine",
                    uri: menuRow.file.uri,
                    line: menuRow.line.line
                })
            return
        case "copy":
            vscode.postMessage({ type: "copy", text: action.text })
            return
    }
}

/**
 * A line opens its file at the match. A folder or file row collapses or expands.
 * With `nextMatch`, activating the line that opened last opens its next match, and after the last match its first one again.
 * Without it, that line opens the same match again.
 */
function activate(index: number, open: OpenOptions, nextMatch = true): void {
    const row = rows[index]
    switch (row?.kind) {
        case undefined:
            return
        case "folder":
        case "file":
            if (collapsed.has(row.key)) collapsed.delete(row.key)
            else collapsed.add(row.key)
            invalidateLayout()
            return
        case "line": {
            const line = targetLine(rows, index) ?? row.line
            const previous = openedMatchOf(line)
            const match =
                previous === undefined
                    ? 0
                    : nextMatch
                      ? (previous + 1) % Math.max(1, line.ranges.length)
                      : previous
            openedMatch = { line, match }
            openLine(row.file, line, match, open)
            scheduleRender()
            return
        }
    }
}

function openLine(file: FileResult, line: ResultLine, match: number, open: OpenOptions): void {
    vscode.postMessage({
        type: "open",
        uri: file.uri,
        line: line.line,
        range: line.ranges[match],
        ...open
    })
}

/** Picks the platform as the VS Code renderer does, which decides the default fonts of the editor. */
function editorPlatform(userAgent: string): "mac" | "windows" | "linux" {
    if (userAgent.includes("Macintosh")) return "mac"
    if (userAgent.includes("Windows")) return "windows"
    return "linux"
}
