import type { OpenOptions } from "../messages"
import type { Row } from "./tree"

/** What a key pressed on the results does. */
export type RowCommand =
    | { kind: "focus"; index: number }
    | { kind: "activate"; open: OpenOptions }
    | { kind: "toggle" }
    | { kind: "menu" }

export interface KeyPress {
    key: string
    shiftKey: boolean
}

/**
 * Maps a key pressed on the results to a command on the focused row at `index`, as the tree of the built-in Search view does.
 * Up and Down move the focus, Left and Right collapse, expand or move to the parent, Enter opens, Space opens and keeps the focus.
 * Up, Down, Home, End and Right pass over context lines, since the tree of the built-in Search view holds none.
 * The context menu key or Shift+F10 opens the menu of a matched line.
 * `index` -1 means that no row holds the focus. Returns `undefined` for a key without a command.
 */
export function rowCommand(
    rows: readonly Row[],
    index: number,
    press: KeyPress
): RowCommand | undefined {
    if (rows.length === 0) return undefined
    const row = rows[index]
    switch (press.key) {
        case "ArrowDown":
            return focusStop(
                rows,
                index < 0 ? firstStop(rows) : (stopAfter(rows, index, 1) ?? index)
            )
        case "ArrowUp":
            return focusStop(
                rows,
                index < 0 ? firstStop(rows) : (stopAfter(rows, index, -1) ?? index)
            )
        case "Home":
            return focusStop(rows, firstStop(rows))
        case "End":
            return focusStop(rows, stopAfter(rows, rows.length, -1))
    }
    if (!row) return undefined
    switch (press.key) {
        case "Enter":
            return { kind: "activate", open: { preview: false, preserveFocus: false } }
        case " ":
            return { kind: "activate", open: { preview: true, preserveFocus: true } }
        case "ArrowLeft":
            if (row.kind !== "line" && !row.collapsed) return { kind: "toggle" }
            return focusParent(rows, index)
        case "ArrowRight":
            if (row.kind === "line") return undefined
            if (row.collapsed) return { kind: "toggle" }
            return focusStop(rows, stopAfter(rows, index, 1))
        case "ContextMenu":
            return isMatch(row) ? { kind: "menu" } : undefined
        case "F10":
            return press.shiftKey && isMatch(row) ? { kind: "menu" } : undefined
    }
    return undefined
}

function isMatch(row: Row): boolean {
    return row.kind === "line" && row.line.match
}

/** Says whether Up and Down stop on `row`: every row except a context line. */
function isStop(row: Row): boolean {
    return row.kind !== "line" || row.line.match
}

/** Returns the index of the first row from `index` in the direction of `step` that Up and Down stop on, `index` itself left out. Undefined past the last one. */
function stopAfter(rows: readonly Row[], index: number, step: 1 | -1): number | undefined {
    for (
        let candidate = index + step;
        candidate >= 0 && candidate < rows.length;
        candidate += step
    ) {
        if (isStop(rows[candidate] as Row)) return candidate
    }
    return undefined
}

function firstStop(rows: readonly Row[]): number | undefined {
    return stopAfter(rows, -1, 1)
}

/** Focuses the row at `index`. Undefined for a missing index. */
function focusStop(rows: readonly Row[], index: number | undefined): RowCommand | undefined {
    return index === undefined || index < 0 || index >= rows.length
        ? undefined
        : { kind: "focus", index }
}

/** The first row that Up and Down stop on. -1 without rows. */
export function firstFocusableRow(rows: readonly Row[]): number {
    return firstStop(rows) ?? -1
}

/** Moves the focus to the nearest row above that sits higher in the tree: from a line to its file, from a file to its folder, from a folder to its parent folder. */
function focusParent(rows: readonly Row[], index: number): RowCommand | undefined {
    const row = rows[index]
    if (!row) return undefined
    for (let candidate = index - 1; candidate >= 0; candidate--) {
        const parent = rows[candidate]
        if (parent && parent.depth < row.depth) return { kind: "focus", index: candidate }
    }
    return undefined
}
