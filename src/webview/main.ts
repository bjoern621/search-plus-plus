import type { HostMessage, SearchStatus, TestSnapshot, ViewMessage } from "../messages";
import { hintFor, parseQuery, type Hint } from "../query";
import { type FileFields, PathFilter } from "../search/globs";
import { appendEntry, fileEntry, folderEntry, onlyAdded } from "./exclusions";
import { type KeyPress, rowCommand } from "./keyboard";
import { fileIcon } from "./icons";
import { QueryHighlight, renderHint } from "./queryInput";
import { highlightParts, resultSummary, ResultTree, type Row, rowAt, rowOffsets } from "./tree";

interface ViewState extends FileFields {
  query: string;
  history: string[];
  fileFieldsOpen: boolean;
}

declare function acquireVsCodeApi(): {
  postMessage(message: ViewMessage): void;
  getState(): ViewState | undefined;
  setState(state: ViewState): void;
};

const HISTORY_LIMIT = 50;
/** Rows rendered above and below the visible ones, so fast scrolling shows no gaps. */
const OVERSCAN_ROWS = 20;
/** Time after the last keystroke in a files to include or exclude field before the search repeats. */
const FILE_FIELDS_SEARCH_DELAY_MS = 400;

const vscode = acquireVsCodeApi();
const input = document.getElementById("query") as HTMLInputElement;
const queryHighlight = new QueryHighlight(input, document.getElementById("query-highlight") as HTMLDivElement);
const hint = document.getElementById("hint") as HTMLDivElement;
const detailsButton = document.getElementById("details") as HTMLButtonElement;
const fileFieldsElement = document.getElementById("file-fields") as HTMLDivElement;
const includeInput = document.getElementById("include") as HTMLInputElement;
const excludeInput = document.getElementById("exclude") as HTMLInputElement;
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
/** The hint of the host that stopped the last search. It replaces the hint on the typed query until the text changes. */
let blockedHint: Hint | undefined;
/** The query and fields of the last search, so a change of the fields can repeat it. */
let searched: ({ query: string } & FileFields) | undefined;
let fileFieldsTimer = 0;
/** Index of the row that holds the keyboard focus inside the results, -1 without one. */
let focusedIndex = -1;

const state: ViewState = { query: "", history: [], include: "", exclude: "", fileFieldsOpen: false, ...vscode.getState() };
includeInput.value = state.include;
excludeInput.value = state.exclude;
/** Position in the history while Up and Down walk it. `history.length` stands for the text being typed. */
let historyIndex = state.history.length;
setQuery(state.query);
setFileFieldsOpen(state.fileFieldsOpen);

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

input.addEventListener("input", () => {
  blockedHint = undefined;
  refreshHint();
  saveState();
});

detailsButton.addEventListener("click", () => setFileFieldsOpen(fileFieldsElement.hidden));

for (const field of [includeInput, excludeInput]) {
  field.addEventListener("keydown", (event) => {
    if (event.key === "Enter") submit();
  });
  field.addEventListener("input", () => applyFileFields());
}

rowsElement.addEventListener("click", (event) => {
  const excludeButton = (event.target as HTMLElement).closest<HTMLElement>(".exclude");
  if (excludeButton) {
    exclude(excludeButton.dataset.entry ?? "");
    return;
  }
  const index = rowIndexFromEvent(event);
  const row = rows[index];
  if (!row) return;
  focusRow(index);
  activate(row, true);
});

results.addEventListener("keydown", (event) => {
  if (event.target !== results) return;
  if (handleRowKey(event)) event.preventDefault();
});

rowsElement.addEventListener("dblclick", (event) => {
  const row = rows[rowIndexFromEvent(event)];
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
      blockedHint = message.hint;
      refreshHint();
      return;
    case "searchDone":
      if (message.searchId !== searchId) return;
      status = message.status;
      cappedAt = message.status === "capped" ? message.limit : undefined;
      invalidateLayout();
      return;
    case "testSearch":
      if (message.fields) setFileFields(message.fields);
      setQuery(message.query);
      submit();
      return;
    case "testSnapshot":
      vscode.postMessage({ type: "testSnapshot", snapshot: snapshot() });
      return;
    case "testClickRow":
      clickRow(message.index);
      return;
    case "testClickHint":
      hint.querySelector<HTMLButtonElement>(".hint-run")?.click();
      return;
    case "testExcludeRow":
      showRow(message.index)?.querySelector<HTMLElement>(".exclude")?.click();
      return;
    case "testPressKeys":
      for (const key of message.keys) pressKey(key);
      return;
    case "testTypeFileFields":
      setFileFields(message);
      applyFileFields();
      return;
  }
});

vscode.postMessage({ type: "ready" });

function submit(): void {
  const query = input.value;
  if (query !== "" && state.history.at(-1) !== query) state.history = [...state.history, query].slice(-HISTORY_LIMIT);
  historyIndex = state.history.length;
  saveState();
  searchWithFields(query);
}

function searchWithFields(query: string): void {
  window.clearTimeout(fileFieldsTimer);
  const fields: FileFields = { include: includeInput.value, exclude: excludeInput.value };
  searched = { query, ...fields };
  vscode.postMessage({ type: "search", query, ...fields });
}

/**
 * Follows a change of the files to include and exclude fields.
 * A change that only adds exclusions hides their results at once.
 * Any other change repeats the last search once typing stops, since it can bring back files that the last search left out.
 */
function applyFileFields(): void {
  saveState();
  window.clearTimeout(fileFieldsTimer);
  if (!searched) return;
  const fields: FileFields = { include: includeInput.value, exclude: excludeInput.value };
  if (fields.include === searched.include && onlyAdded(searched.exclude, fields.exclude)) {
    tree.setFilter(new PathFilter(fields));
    invalidateLayout();
    return;
  }
  const query = searched.query;
  fileFieldsTimer = window.setTimeout(() => searchWithFields(query), FILE_FIELDS_SEARCH_DELAY_MS);
}

/** Adds `entry` to files to exclude and drops its results without a new search. */
function exclude(entry: string): void {
  excludeInput.value = appendEntry(excludeInput.value, entry);
  setFileFieldsOpen(true);
  applyFileFields();
}

function setFileFields(fields: FileFields): void {
  includeInput.value = fields.include;
  excludeInput.value = fields.exclude;
  saveState();
}

function setFileFieldsOpen(open: boolean): void {
  fileFieldsElement.hidden = !open;
  detailsButton.classList.toggle("active", open);
  detailsButton.setAttribute("aria-expanded", String(open));
  state.fileFieldsOpen = open;
  saveState();
}

function walkHistory(step: -1 | 1): void {
  const next = historyIndex + step;
  if (next < 0 || next > state.history.length) return;
  historyIndex = next;
  setQuery(state.history[next] ?? "");
}

/** Puts `query` into the input as if typed. */
function setQuery(query: string): void {
  input.value = query;
  blockedHint = undefined;
  queryHighlight.update();
  refreshHint();
  saveState();
}

function runSuggestedQuery(query: string): void {
  setQuery(query);
  input.focus();
  submit();
}

function saveState(): void {
  state.query = input.value;
  state.include = includeInput.value;
  state.exclude = excludeInput.value;
  vscode.setState(state);
}

function startSearch(id: number): void {
  searchId = id;
  status = "running";
  cappedAt = undefined;
  tree.clear();
  collapsed.clear();
  focusedIndex = -1;
  results.removeAttribute("aria-activedescendant");
  results.scrollTop = 0;
  blockedHint = undefined;
  refreshHint();
  invalidateLayout();
}

function refreshHint(): void {
  renderHint(hint, blockedHint ?? hintFor(parseQuery(input.value)), blockedHint !== undefined, runSuggestedQuery);
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
  if (focusedIndex >= rows.length) focusedIndex = rows.length - 1;
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
  element.id = `row-${index}`;
  if (index === focusedIndex) element.classList.add("focused");
  element.style.top = `${offsets[index] ?? 0}px`;
  element.setAttribute("role", "treeitem");
  switch (row.kind) {
    case "folder":
      element.className = "row";
      element.setAttribute("aria-expanded", String(!row.collapsed));
      element.title = row.label;
      element.append(span("twisty", row.collapsed ? "▶" : "▼"), span("folder-icon", "■"), span("label", row.label));
      if (row.folder !== "") element.append(excludeButton(`Exclude folder ${row.folder}`, folderEntry(row.folder)));
      return element;
    case "file": {
      const icon = fileIcon(row.file.name);
      const glyph = span("file-icon", icon.glyph);
      glyph.style.color = icon.color;
      element.className = "row";
      element.setAttribute("aria-expanded", String(!row.collapsed));
      element.title = [row.file.root, row.file.folder, row.file.name].filter((part) => part !== "").join("/");
      element.append(span("twisty", row.collapsed ? "▶" : "▼"), glyph, span("label", row.file.name), excludeButton(`Exclude ${row.file.name}`, fileEntry(row.file)));
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

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/** A circle with a slash, as on the exclude button of the built-in Search view. */
function excludeButton(label: string, entry: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "icon exclude";
  button.tabIndex = -1;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.dataset.entry = entry;
  const svg = document.createElementNS(SVG_NAMESPACE, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  const circle = document.createElementNS(SVG_NAMESPACE, "circle");
  for (const [name, value] of Object.entries({ cx: "8", cy: "8", r: "5.5" })) circle.setAttribute(name, value);
  const slash = document.createElementNS(SVG_NAMESPACE, "path");
  slash.setAttribute("d", "M4.1 11.9 11.9 4.1");
  svg.append(circle, slash);
  button.append(svg);
  return button;
}

function span(className: string, text: string, tag: "span" | "mark" = "span"): HTMLElement {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

/** Returns the index of the row under the event, -1 outside of every row. */
function rowIndexFromEvent(event: Event): number {
  const element = (event.target as HTMLElement).closest<HTMLElement>("[data-index]");
  return element ? Number(element.dataset.index) : -1;
}

/** Runs the command of a key pressed on the results. Returns false for a key without a command, so the browser handles it. */
function handleRowKey(press: KeyPress): boolean {
  const command = rowCommand(rows, focusedIndex, press);
  if (!command) return false;
  const row = rows[focusedIndex];
  switch (command.kind) {
    case "focus":
      focusRow(command.index);
      return true;
    case "activate":
      if (row) activate(row, command.preserveFocus);
      return true;
    case "toggle":
      if (row) activate(row, true);
      return true;
  }
}

/** Moves the keyboard focus to the row at `index` and scrolls it into view. */
function focusRow(index: number): void {
  focusedIndex = index;
  layout();
  const top = offsets[index] ?? 0;
  const bottom = offsets[index + 1] ?? top;
  if (top < results.scrollTop) results.scrollTop = top;
  else if (bottom > results.scrollTop + results.clientHeight) results.scrollTop = bottom - results.clientHeight;
  results.setAttribute("aria-activedescendant", `row-${index}`);
  render();
}

/** Presses `key` on the results, as a person would. `Shift+` in front holds Shift. */
function pressKey(key: string): void {
  results.focus();
  const shiftKey = key.startsWith("Shift+");
  results.dispatchEvent(new KeyboardEvent("keydown", { key: shiftKey ? key.slice("Shift+".length) : key, shiftKey, bubbles: true, cancelable: true }));
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
    hint: hint.hidden ? "" : (hint.dataset.text ?? ""),
    include: includeInput.value,
    exclude: excludeInput.value,
    rows: rows.map(describeRow),
    focused: focusedIndex,
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
  showRow(index)?.click();
}

/** Scrolls the row at `index` into view and returns its element. */
function showRow(index: number): HTMLElement | null {
  layout();
  results.scrollTop = offsets[index] ?? 0;
  render();
  return rowsElement.querySelector<HTMLElement>(`[data-index="${index}"]`);
}
