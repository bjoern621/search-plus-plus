import type { Row } from "./tree";

/** What a key pressed on the results does. */
export type RowCommand =
  | { kind: "focus"; index: number }
  | { kind: "activate"; preserveFocus: boolean }
  | { kind: "toggle" }
  | { kind: "menu" };

export interface KeyPress {
  key: string;
  shiftKey: boolean;
}

/**
 * Maps a key pressed on the results to a command on the focused row at `index`, as the tree of the built-in Search view does.
 * Up and Down move the focus, Left and Right collapse, expand or move to the parent, Enter opens, Space opens and keeps the focus.
 * The context menu key or Shift+F10 opens the menu of a matched line.
 * `index` -1 means that no row holds the focus. Returns `undefined` for a key without a command.
 */
export function rowCommand(rows: readonly Row[], index: number, press: KeyPress): RowCommand | undefined {
  if (rows.length === 0) return undefined;
  const row = rows[index];
  switch (press.key) {
    case "ArrowDown":
      return { kind: "focus", index: Math.min(index + 1, rows.length - 1) };
    case "ArrowUp":
      return { kind: "focus", index: Math.max(index - 1, 0) };
    case "Home":
      return { kind: "focus", index: 0 };
    case "End":
      return { kind: "focus", index: rows.length - 1 };
  }
  if (!row) return undefined;
  switch (press.key) {
    case "Enter":
      return { kind: "activate", preserveFocus: false };
    case " ":
      return { kind: "activate", preserveFocus: true };
    case "ArrowLeft":
      if (row.kind !== "line" && !row.collapsed) return { kind: "toggle" };
      return focusParent(rows, index);
    case "ArrowRight":
      if (row.kind === "line") return undefined;
      if (row.collapsed) return { kind: "toggle" };
      return index + 1 < rows.length ? { kind: "focus", index: index + 1 } : undefined;
    case "ContextMenu":
      return isMatch(row) ? { kind: "menu" } : undefined;
    case "F10":
      return press.shiftKey && isMatch(row) ? { kind: "menu" } : undefined;
  }
  return undefined;
}

function isMatch(row: Row): boolean {
  return row.kind === "line" && row.line.match;
}

/** Moves the focus from a line to its file row and from a file row to its folder row. */
function focusParent(rows: readonly Row[], index: number): RowCommand | undefined {
  const kind = rows[index]?.kind;
  if (kind === "folder") return undefined;
  const parentKind = kind === "line" ? "file" : "folder";
  for (let candidate = index - 1; candidate >= 0; candidate--) {
    if (rows[candidate]?.kind === parentKind) return { kind: "focus", index: candidate };
  }
  return undefined;
}
