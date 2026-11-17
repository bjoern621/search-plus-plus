import type { HostMessage, SearchStatus, TestSnapshot, ViewMessage } from "../messages";
import { fileIcon } from "./icons";
import { highlightParts, resultSummary, ResultTree, type Row, rowAt, rowOffsets } from "./tree";

interface ViewState {
  query: string;
  history: string[];
}

declare function acquireVsCodeApi(): {
  postMessage(message: ViewMessage): void;
  getState(): ViewState | undefined;
  setState(state: ViewState): void;
};

const HISTORY_LIMIT = 50;
/** Rows rendered above and below the visible ones, so fast scrolling shows no gaps. */
const OVERSCAN_ROWS = 20;

const vscode = acquireVsCodeApi();
const input = document.getElementById("query") as HTMLInputElement;
const hint = document.getElementById("hint") as HTMLDivElement;
const summary = document.getElementById("summary") as HTMLDivElement;
const summaryText = document.getElementById("summary-text") as HTMLSpanElement;
const scope = document.getElementById("scope") as HTMLButtonElement;
const results = document.getElementById("results") as HTMLDivElement;
const rowsElement = document.getElementById("rows") as HTMLDivElement;

const tree = new ResultTree();
/** Keys of the collapsed folder and file rows. */
const collapsed = new Set<string>();
let searchId = 0;
let status: SearchStatus | "running" | "idle" = "idle";
let cappedAt: number | undefined;
let rows: Row[] = [];
let offsets: number[] = [0];
let layoutStale = false;
let frame = 0;

const state: ViewState = vscode.getState() ?? { query: "", history: [] };
/** Position in the history while Up and Down walk it. `history.length` stands for the text being typed. */
let historyIndex = state.history.length;
input.value = state.query;

input.addEventListener("keydown", (event) => {
  switch (event.key) {
    case "Enter":
      submit();
      return;
    case "ArrowUp":
    case "ArrowDown":
      event.preventDefault();
      walkHistory(event.key === "ArrowUp" ? -1 : 1);
      return;
  }
});

input.addEventListener("input", () => saveState());

rowsElement.addEventListener("click", (event) => {
  const row = rowFromEvent(event);
  if (row) activate(row, true);
});

rowsElement.addEventListener("dblclick", (event) => {
  const row = rowFromEvent(event);
  if (row?.kind === "line") activate(row, false);
});

results.addEventListener("scroll", () => scheduleRender());
new ResizeObserver(() => scheduleRender()).observe(results);

window.addEventListener("message", (event: MessageEvent<HostMessage>) => {
  const message = event.data;
  switch (message.type) {
    case "focus":
      input.focus();
      input.select();
      return;
    case "searchStarted":
      startSearch(message.searchId);
      return;
    case "results":
      if (message.searchId !== searchId) return;
      tree.add(message.files);
      invalidateLayout();
      return;
    case "hint":
      if (message.searchId !== searchId) return;
      showHint(message.text);
      return;
    case "searchDone":
      if (message.searchId !== searchId) return;
      status = message.status;
      cappedAt = message.status === "capped" ? message.limit : undefined;
      invalidateLayout();
      return;
    case "testSearch":
      input.value = message.query;
      submit();
      return;
    case "testSnapshot":
      vscode.postMessage({ type: "testSnapshot", snapshot: snapshot() });
      return;
    case "testClickRow":
      clickRow(message.index);
      return;
  }
});

vscode.postMessage({ type: "ready" });

function submit(): void {
  const query = input.value;
  if (query !== "" && state.history.at(-1) !== query) state.history = [...state.history, query].slice(-HISTORY_LIMIT);
  historyIndex = state.history.length;
  saveState();
  vscode.postMessage({ type: "search", query });
}

function walkHistory(step: -1 | 1): void {
  const next = historyIndex + step;
  if (next < 0 || next > state.history.length) return;
  historyIndex = next;
  input.value = state.history[next] ?? "";
  saveState();
}

function saveState(): void {
  state.query = input.value;
  vscode.setState(state);
}

function startSearch(id: number): void {
  searchId = id;
  status = "running";
  cappedAt = undefined;
  tree.clear();
  collapsed.clear();
  results.scrollTop = 0;
  showHint("");
  invalidateLayout();
}

function showHint(text: string): void {
  hint.textContent = text;
  hint.hidden = text === "";
}

function invalidateLayout(): void {
  layoutStale = true;
  scheduleRender();
}

function scheduleRender(): void {
  if (frame !== 0) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    render();
  });
}

function layout(): void {
  if (!layoutStale) return;
  layoutStale = false;
  rows = tree.rows(collapsed);
  offsets = rowOffsets(rows);
  rowsElement.style.height = `${offsets.at(-1) ?? 0}px`;
  const widest = rows.reduce((max, row) => (row.kind === "line" ? Math.max(max, row.line.line + 1) : max), 0);
  rowsElement.style.setProperty("--line-number-width", `${Math.max(2, String(widest).length)}ch`);
  renderSummary();
}

function renderSummary(): void {
  const text = summaryFor();
  summary.hidden = text === undefined;
  summaryText.textContent = text ?? "";
  scope.hidden = status === "noFolder";
}

function summaryFor(): string | undefined {
  switch (status) {
    case "idle":
    case "empty":
    case "blocked":
      return undefined;
    case "noFolder":
      return "Open a folder to search it.";
    case "running":
      return tree.matchCount === 0 ? undefined : resultSummary(tree.matchCount, tree.fileCount);
    case "complete":
      return resultSummary(tree.matchCount, tree.fileCount);
    case "capped":
      return resultSummary(tree.matchCount, tree.fileCount, cappedAt);
  }
}

/** Renders the rows in view. The others stay out of the page, so thousands of results scroll smoothly. */
function render(): void {
  layout();
  const top = results.scrollTop;
  const first = Math.max(0, rowAt(offsets, top) - OVERSCAN_ROWS);
  const last = Math.min(rows.length, rowAt(offsets, top + results.clientHeight) + OVERSCAN_ROWS + 1);
  const elements: HTMLElement[] = [];
  for (let index = first; index < last; index++) {
    const row = rows[index];
    if (row) elements.push(rowElement(row, index));
  }
  rowsElement.replaceChildren(...elements);
}

function rowElement(row: Row, index: number): HTMLElement {
  const element = document.createElement("div");
  element.dataset.index = String(index);
  element.style.top = `${offsets[index] ?? 0}px`;
  element.setAttribute("role", "treeitem");
  switch (row.kind) {
    case "folder":
      element.className = "row";
      element.setAttribute("aria-expanded", String(!row.collapsed));
      element.title = row.label;
      element.append(span("twisty", row.collapsed ? "▶" : "▼"), span("folder-icon", "■"), span("label", row.label));
      return element;
    case "file": {
      const icon = fileIcon(row.file.name);
      const glyph = span("file-icon", icon.glyph);
      glyph.style.color = icon.color;
      element.className = "row";
      element.setAttribute("aria-expanded", String(!row.collapsed));
      element.title = [row.file.root, row.file.folder, row.file.name].filter((part) => part !== "").join("/");
      element.append(span("twisty", row.collapsed ? "▶" : "▼"), glyph, span("label", row.file.name));
      return element;
    }
    case "line": {
      element.className = row.line.match ? "line match" : "line";
      const text = span("text", row.line.offset > 0 ? "…" : "");
      for (const part of highlightParts(row.line)) {
        if (part.marked) text.append(span("mark", part.text, "mark"));
        else text.append(part.text);
      }
      element.append(span("number", String(row.line.line + 1)), text);
      return element;
    }
  }
}

function span(className: string, text: string, tag: "span" | "mark" = "span"): HTMLElement {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

function rowFromEvent(event: MouseEvent): Row | undefined {
  const element = (event.target as HTMLElement).closest<HTMLElement>("[data-index]");
  if (!element) return undefined;
  return rows[Number(element.dataset.index)];
}

/** A line opens its file at the match. A folder or file row collapses or expands. */
function activate(row: Row, preserveFocus: boolean): void {
  switch (row.kind) {
    case "folder":
    case "file":
      if (collapsed.has(row.key)) collapsed.delete(row.key);
      else collapsed.add(row.key);
      invalidateLayout();
      return;
    case "line":
      vscode.postMessage({ type: "open", uri: row.file.uri, line: row.line.line, range: row.line.ranges[0], preserveFocus });
      return;
  }
}

function snapshot(): TestSnapshot {
  layout();
  return {
    summary: summary.hidden ? "" : `${summaryText.textContent ?? ""} | ${scope.hidden ? "" : (scope.textContent ?? "")}`,
    hint: hint.hidden ? "" : (hint.textContent ?? ""),
    rows: rows.map(describeRow),
  };
}

function describeRow(row: Row): string {
  switch (row.kind) {
    case "folder":
      return `folder ${row.label}`;
    case "file":
      return `file ${row.file.name}`;
    case "line": {
      const text = highlightParts(row.line)
        .map((part) => (part.marked ? `[${part.text}]` : part.text))
        .join("");
      return `${row.line.match ? "match" : "context"} ${row.line.line + 1}: ${text}`;
    }
  }
}

/** Scrolls the row at `index` into view and clicks its element, as a person would. */
function clickRow(index: number): void {
  layout();
  results.scrollTop = offsets[index] ?? 0;
  render();
  rowsElement.querySelector<HTMLElement>(`[data-index="${index}"]`)?.click();
}
