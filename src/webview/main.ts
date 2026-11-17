import type { FileResult, HostMessage, KeyPathRoom, RowMetrics, SearchStatus, TestSnapshot, ViewMessage } from "../messages";
import { hintFor, parseQuery, type Hint } from "../query";
import { type FileFields, PathFilter } from "../search/globs";
import { type GitInfo, type SearchScope, WORKING_TREE } from "../search/scope";
import { appendEntry, fileEntry, folderEntry, onlyAdded } from "./exclusions";
import { ContextMenu } from "./contextMenu";
import { HoverCard } from "./hoverCard";
import { firstFocusableRow, type KeyPress, rowCommand } from "./keyboard";
import { matchMenu, type MenuAction } from "./menu";
import { FileIconTheme } from "./fileIcons";
import { QueryHighlight, renderHint } from "./queryInput";
import { scopeLabel, scopeMenu } from "./scopeMenu";
import { commitDay, describeLine, highlightParts, resultSummary, ResultTree, type Row, rowAt, rowOffsets } from "./tree";
import { fitKeyPaths, keyPathCuts, keyPathElement, keyPathText, shownKeys } from "./keyPath";

interface ViewState extends FileFields {
  query: string;
  history: string[];
  fileFieldsOpen: boolean;
  scope: SearchScope;
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
const contextMenu = new ContextMenu(document.getElementById("menu") as HTMLDivElement, runMenuAction, () => results.focus());
const hoverElement = document.getElementById("hover") as HTMLDivElement;
const hoverCard = new HoverCard(hoverElement, (requestId, uri, line) => vscode.postMessage({ type: "excerpt", requestId, uri, line }), renderedMatch);

const tree = new ResultTree();
const iconTheme = new FileIconTheme();
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
/** The query, fields and scope of the last search, so a change of the fields or the scope can repeat it. */
let searched: ({ query: string; scope: SearchScope } & FileFields) | undefined;
/** What the host found out about Git. Undefined until it answers. */
let git: GitInfo | undefined;
let fileFieldsTimer = 0;
/** Index of the row that holds the keyboard focus inside the results, -1 without one. */
let focusedIndex = -1;
/** The line whose context menu shows. */
let menuRow: Extract<Row, { kind: "line" }> | undefined;
/** The scroll position at which the context menu opened. A scroll event that leaves it unchanged keeps the menu open. */
let menuScrollTop = 0;
/** The scroll position at which the hover card got its match. */
let hoverScrollTop = 0;

const state: ViewState = { query: "", history: [], include: "", exclude: "", fileFieldsOpen: false, scope: WORKING_TREE, ...vscode.getState() };
includeInput.value = state.include;
excludeInput.value = state.exclude;
/** Position in the history while Up and Down walk it. `history.length` stands for the text being typed. */
let historyIndex = state.history.length;
setQuery(state.query);
setFileFieldsOpen(state.fileFieldsOpen);
renderSummary();

input.addEventListener("keydown", (event) => {
  if (moveBetweenFields(event)) {
    event.preventDefault();
    return;
  }
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

// A click from Enter or Space on the button counts no presses.
scope.addEventListener("click", (event) => openScopeMenu(event.detail === 0));

for (const field of [includeInput, excludeInput]) {
  field.addEventListener("keydown", (event) => {
    if (moveBetweenFields(event)) event.preventDefault();
    else if (event.key === "Enter") submit();
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

rowsElement.addEventListener("contextmenu", (event) => {
  if (openMenu(rowIndexFromEvent(event), false)) event.preventDefault();
});

rowsElement.addEventListener("mouseover", (event) => {
  // The render that focuses the row of an opening menu puts a new element under the pointer, which fires a mouseover.
  if (contextMenu.isOpen) return;
  const row = rows[rowIndexFromEvent(event)];
  if (row?.kind !== "line" || !row.line.match) {
    hoverCard.hide();
    return;
  }
  hoverScrollTop = results.scrollTop;
  hoverCard.schedule(row.file, row.line.line);
});

results.addEventListener("mouseleave", () => hoverCard.hide());
document.addEventListener("keydown", () => hoverCard.hide(), true);
window.addEventListener("blur", () => hoverCard.hide());

// The context menu key fires a contextmenu event on the results after the keydown that opened the menu.
results.addEventListener("contextmenu", (event) => {
  if (event.target === results) event.preventDefault();
});

results.addEventListener("scroll", () => {
  if (results.scrollTop !== menuScrollTop) contextMenu.close(false);
  if (results.scrollTop !== hoverScrollTop) hoverCard.hide();
  scheduleRender();
});
new ResizeObserver(() => scheduleRender()).observe(results);

window.addEventListener("message", (event: MessageEvent<HostMessage>) => {
  const message = event.data;
  switch (message.type) {
    case "focus":
      input.focus();
      input.select();
      return;
    case "git":
      git = message.git;
      renderSummary();
      return;
    case "branchPicked":
      chooseScope({ kind: "branch", branch: message.branch });
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
    case "icons":
      iconTheme.set(message.theme);
      tree.setIcons(message.files);
      invalidateLayout();
      return;
    case "excerpt":
      hoverCard.show(message.requestId, message.lines);
      return;
    case "searchDone":
      if (message.searchId !== searchId) return;
      status = message.status;
      cappedAt = message.status === "capped" ? message.limit : undefined;
      invalidateLayout();
      return;
    case "testSearch":
      if (message.fields) setFileFields(message.fields);
      if (message.scope) setScope(message.scope);
      setQuery(message.query);
      submit();
      return;
    case "testSnapshot":
      vscode.postMessage({ type: "testSnapshot", snapshot: snapshot() });
      return;
    case "testOpenScopeMenu":
      scope.click();
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
    case "testOpenMenu":
      showRow(message.index)?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 }));
      return;
    case "testHover":
      showRow(message.index)?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      return;
    case "testChooseMenuItem":
      contextMenu.chooseLabel(message.label);
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
  searched = { query, scope: state.scope, ...fields };
  vscode.postMessage({ type: "search", query, scope: state.scope, ...fields });
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

/** Sets the scope of later searches and repeats the last search in it. */
function chooseScope(next: SearchScope): void {
  setScope(next);
  if (searched) searchWithFields(searched.query);
}

function setScope(next: SearchScope): void {
  state.scope = next;
  saveState();
  renderSummary();
}

function setFileFieldsOpen(open: boolean): void {
  fileFieldsElement.hidden = !open;
  detailsButton.classList.toggle("active", open);
  detailsButton.setAttribute("aria-expanded", String(open));
  state.fileFieldsOpen = open;
  saveState();
}

/**
 * Moves the focus with Ctrl+Down and Ctrl+Up, or Cmd on macOS, as the built-in Search view does.
 * Ctrl+Down goes from the query to files to include and files to exclude while they show, then into the results.
 * Ctrl+Up goes back from files to exclude to the query.
 * Returns false for any other key.
 */
function moveBetweenFields(event: KeyboardEvent): boolean {
  if (!(event.ctrlKey || event.metaKey) || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return false;
  const fields = fileFieldsElement.hidden ? [input] : [input, includeInput, excludeInput];
  const index = fields.indexOf(event.target as HTMLInputElement);
  if (index < 0) return false;
  if (event.key === "ArrowUp") {
    const previous = fields[index - 1];
    if (!previous) return false;
    previous.focus();
    previous.select();
    return true;
  }
  const next = fields[index + 1];
  if (next) {
    next.focus();
    next.select();
    return true;
  }
  focusResults();
  return true;
}

/** Moves the keyboard focus into the results, onto the first row unless a row holds it already. */
function focusResults(): void {
  layout();
  results.focus();
  if (focusedIndex < 0 && rows.length > 0) focusRow(firstFocusableRow(rows));
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
  hoverCard.hide();
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

/**
 * Shows the counts and the scope button.
 * The button shows without results as well, so the scope can change before the first search.
 * A scope other than the working tree shows in color, so a Git search never passes for a working tree search.
 */
function renderSummary(): void {
  const otherScope = state.scope.kind !== "workingTree";
  summaryText.textContent = summaryFor() ?? "";
  scope.hidden = status === "noFolder";
  scope.textContent = `${scopeLabel(state.scope, git)} ▾`;
  scope.classList.toggle("other", otherScope);
}

function summaryFor(): string | undefined {
  switch (status) {
    case "idle":
    case "empty":
    case "blocked":
      return undefined;
    case "noFolder":
      return "Open a folder to search it.";
    case "noRepository":
      return "No Git repository holds this workspace. Pick Working tree to search its files.";
    case "failed":
      return "The search could not finish. The Structural Search output says why.";
    case "running":
      return tree.matchCount === 0 ? undefined : resultSummary(tree.matchCount, tree.fileCount, undefined, shownCommitCount());
    case "complete":
      return resultSummary(tree.matchCount, tree.fileCount, undefined, shownCommitCount());
    case "capped":
      return resultSummary(tree.matchCount, tree.fileCount, cappedAt, shownCommitCount());
  }
}

/** The number of commits for the summary of a history search. Undefined in any other scope. */
function shownCommitCount(): number | undefined {
  return searched?.scope.kind === "history" ? tree.commitCount : undefined;
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
  fitKeyPaths(rowsElement.querySelectorAll<HTMLElement>(".key-path"));
}

function rowElement(row: Row, index: number): HTMLElement {
  const element = document.createElement("div");
  element.dataset.index = String(index);
  element.id = `row-${index}`;
  if (index === focusedIndex) element.classList.add("focused");
  element.style.top = `${offsets[index] ?? 0}px`;
  element.setAttribute("role", "treeitem");
  switch (row.kind) {
    case "commit":
      element.classList.add("row", "commit");
      element.setAttribute("aria-expanded", String(!row.collapsed));
      element.title = `${row.commit.sha}\n${row.commit.author}, ${row.commit.date}\n${row.commit.subject}`;
      element.append(span("twisty", row.collapsed ? "▶" : "▼"), span("sha", row.commit.shortSha), span("label", row.commit.subject), span("commit-meta", `${row.commit.author}, ${commitDay(row.commit)}`));
      return element;
    case "folder":
      element.classList.add("row");
      element.setAttribute("aria-expanded", String(!row.collapsed));
      element.title = row.label;
      const icon = iconTheme.folderElement(row.icon);
      element.append(span("twisty", row.collapsed ? "▶" : "▼"), ...(icon ? [icon] : []), span("label", row.label));
      if (row.folder !== "") element.append(excludeButton(`Exclude folder ${row.folder}`, folderEntry(row.folder)));
      return element;
    case "file": {
      element.classList.add("row");
      element.setAttribute("aria-expanded", String(!row.collapsed));
      element.title = [row.file.root, row.file.folder, row.file.name].filter((part) => part !== "").join("/");
      element.append(span("twisty", row.collapsed ? "▶" : "▼"), iconTheme.element(row.file.icons?.file), span("label", row.file.name), excludeButton(`Exclude ${row.file.name}`, fileEntry(row.file)));
      return element;
    }
    case "line": {
      element.classList.add("line");
      if (row.line.match) element.classList.add("match");
      const text = span("text", row.line.offset > 0 ? "…" : "");
      for (const part of highlightParts(row.line)) {
        if (part.marked) text.append(span("mark", part.text, "mark"));
        else text.append(part.text);
      }
      element.append(span("number", String(row.line.line + 1)), text);
      const keys = shownKeys(row.line);
      if (keys) element.append(keyPathElement(keys));
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
    case "menu":
      openMenu(focusedIndex, true);
      return true;
  }
}

/** Moves the keyboard focus to the row at `index` and scrolls it into view. */
function focusRow(index: number): void {
  focusedIndex = index;
  layout();
  scrollRowIntoView(index);
  results.setAttribute("aria-activedescendant", `row-${index}`);
  render();
}

/** Scrolls the results by the least distance that brings the row at `index` into view. */
function scrollRowIntoView(index: number): void {
  const top = offsets[index] ?? 0;
  const bottom = offsets[index + 1] ?? top;
  if (top < results.scrollTop) results.scrollTop = top;
  else if (bottom > results.scrollTop + results.clientHeight) results.scrollTop = bottom - results.clientHeight;
}

/** Opens the context menu of the matched line at `index`. Returns false for any other row. */
function openMenu(index: number, fromKeyboard: boolean): boolean {
  const row = rows[index];
  if (row?.kind !== "line" || !row.line.match) return false;
  focusRow(index);
  const element = rowsElement.querySelector<HTMLElement>(`[data-index="${index}"]`);
  if (!element) return false;
  menuRow = row;
  menuScrollTop = results.scrollTop;
  hoverCard.hide();
  contextMenu.open(matchMenu(row.file, row.line, searched?.query ?? input.value), element.getBoundingClientRect(), fromKeyboard);
  return true;
}

/** Opens the scope menu below the scope button. */
function openScopeMenu(fromKeyboard: boolean): void {
  menuRow = undefined;
  menuScrollTop = results.scrollTop;
  hoverCard.hide();
  contextMenu.open(scopeMenu(state.scope, git), scope.getBoundingClientRect(), fromKeyboard);
}

function runMenuAction(action: MenuAction): void {
  switch (action.kind) {
    case "scope":
      chooseScope(action.scope);
      return;
    case "pickBranch":
      vscode.postMessage({ type: "pickBranch" });
      return;
    case "search":
      setQuery(action.query);
      submit();
      return;
    case "exclude":
      exclude(action.entry);
      return;
    case "copyLine":
      if (menuRow) vscode.postMessage({ type: "copyLine", uri: menuRow.file.uri, line: menuRow.line.line });
      return;
    case "copy":
      vscode.postMessage({ type: "copy", text: action.text });
      return;
  }
}

/**
 * Presses `key` on the focused element of the results or the context menu, as a person would.
 * `Shift+` in front holds Shift, `Ctrl+` holds Ctrl.
 * `query:` in front presses the key in the query input, `field:` in the focused input.
 */
function pressKey(key: string): void {
  const inQuery = key.startsWith("query:");
  const inField = key.startsWith("field:") && document.activeElement instanceof HTMLInputElement;
  let name = key.replace(/^(query|field):/, "");
  const ctrlKey = name.startsWith("Ctrl+");
  if (ctrlKey) name = name.slice("Ctrl+".length);
  const shiftKey = name.startsWith("Shift+");
  if (shiftKey) name = name.slice("Shift+".length);
  const inMenu = document.activeElement?.closest(".menu");
  if (inQuery) input.focus();
  else if (!inMenu && !inField) results.focus();
  const target = inQuery ? input : inMenu || inField ? (document.activeElement as HTMLElement) : results;
  target.dispatchEvent(new KeyboardEvent("keydown", { key: name, ctrlKey, shiftKey, bubbles: true, cancelable: true }));
}

/** A line opens its file at the match. A commit, folder or file row collapses or expands. */
function activate(row: Row, preserveFocus: boolean): void {
  switch (row.kind) {
    case "commit":
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
  // Draws the rows that a pending frame would draw, since the snapshot measures them.
  render();
  return {
    summary: summary.hidden ? "" : `${summaryText.textContent ?? ""} | ${scope.hidden ? "" : (scope.textContent ?? "")}`,
    hint: hint.hidden ? "" : (hint.dataset.text ?? ""),
    include: includeInput.value,
    exclude: excludeInput.value,
    fileFieldsOpen: !fileFieldsElement.hidden,
    rows: rows.map(describeRow),
    icons: rows.map(rowIcon),
    iconLefts: rows.map((_, index) => leftOf(index, ".file-icon")),
    labelLefts: rows.map((_, index) => leftOf(index, ".label")),
    keyPaths: rows.map((row) => {
      const keys = row.kind === "line" ? shownKeys(row.line) : undefined;
      return keys ? keyPathText(keys) : "";
    }),
    drawnKeyPaths: rows.map((_, index) => {
      const element = document.getElementById(`row-${index}`);
      return element ? (element.querySelector(".key-path")?.textContent ?? "") : null;
    }),
    keyPathRooms: rows.map(keyPathRoom),
    focused: Number(rowsElement.querySelector<HTMLElement>(".focused")?.dataset.index ?? -1),
    menu: contextMenu.describe(),
    focusedMarkColor: markColor(".focused .mark"),
    focusHighlightColor: themeColor("--vscode-list-focusHighlightForeground"),
    menuFocus: contextMenu.focusedLabel(),
    hover: hoverCard.describe(),
    hoverGeometry: hoverCard.geometry(),
    fileRowMetrics: rowMetrics("file"),
    codeLineMetrics: rowMetrics("line"),
  };
}

/** Measures the room after the line text of a drawn row, and the drawn and the next longer cut of its key path in a hidden copy. */
function keyPathRoom(row: Row, index: number): KeyPathRoom | null {
  const element = document.getElementById(`row-${index}`);
  const text = element?.querySelector(".text");
  const keys = row.kind === "line" ? shownKeys(row.line) : undefined;
  if (!element || !text || !keys) return null;
  const drawnText = element.querySelector(".key-path")?.textContent ?? "";
  const probe = keyPathElement(keys);
  probe.style.cssText = "position: absolute; visibility: hidden; max-width: none";
  element.append(probe);
  const measure = (cut: string) => {
    probe.textContent = cut;
    return probe.getBoundingClientRect().width - parseFloat(getComputedStyle(probe).paddingLeft);
  };
  const end = element.getBoundingClientRect().right - parseFloat(getComputedStyle(element).paddingRight);
  const room = end - text.getBoundingClientRect().right - parseFloat(getComputedStyle(probe).paddingLeft);
  const cuts = keyPathCuts(keys);
  const drawnAt = drawnText === "" ? cuts.length : cuts.indexOf(drawnText);
  const longer = drawnAt > 0 ? cuts[drawnAt - 1] : undefined;
  const measured = { room, drawn: drawnText === "" ? 0 : measure(drawnText), longer: longer === undefined ? null : measure(longer) };
  probe.remove();
  return measured;
}

function markColor(selector: string): string {
  const mark = rowsElement.querySelector(selector);
  return mark ? getComputedStyle(mark).color : "";
}

/** Resolves the theme color `variable` to the form that getComputedStyle reports. */
function themeColor(variable: string): string {
  const probe = document.createElement("span");
  probe.style.color = `var(${variable})`;
  document.body.append(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}

/** The left edge of the part `selector` of the drawn row at `index`. Null for a row not drawn or without that part. */
function leftOf(index: number, selector: string): number | null {
  const part = rowsElement.querySelector(`[data-index="${index}"] ${selector}`);
  return part ? part.getBoundingClientRect().left : null;
}

function rowMetrics(kind: Row["kind"]): RowMetrics | undefined {
  const element = [...rowsElement.querySelectorAll<HTMLElement>("[data-index]")].find((candidate) => rows[Number(candidate.dataset.index)]?.kind === kind);
  if (!element) return undefined;
  return { fontSize: Number.parseFloat(getComputedStyle(element).fontSize), height: element.getBoundingClientRect().height };
}

function describeRow(row: Row): string {
  switch (row.kind) {
    case "commit":
      return `commit ${row.commit.shortSha} ${row.commit.subject} (${row.commit.author}, ${commitDay(row.commit)})`;
    case "folder":
      return `folder ${row.label}`;
    case "file":
      return `file ${row.file.name}`;
    case "line":
      return describeLine(row.line);
  }
}

function rowIcon(row: Row): string {
  switch (row.kind) {
    case "folder":
      return row.icon ?? "";
    case "file":
      return row.file.icons?.file ?? "";
    case "commit":
    case "line":
      return "";
  }
}

/** Returns the rendered row of the match on `line` of `file`. */
function renderedMatch(file: FileResult, line: number): HTMLElement | undefined {
  const index = rows.findIndex((row) => row.kind === "line" && row.file.uri === file.uri && row.line.line === line);
  return rowsElement.querySelector<HTMLElement>(`[data-index="${index}"]`) ?? undefined;
}

/** Scrolls the row at `index` into view and clicks its element, as a person would. */
function clickRow(index: number): void {
  showRow(index)?.click();
}

/** Scrolls the row at `index` into view and returns its element. */
function showRow(index: number): HTMLElement | null {
  layout();
  scrollRowIntoView(index);
  render();
  return rowsElement.querySelector<HTMLElement>(`[data-index="${index}"]`);
}
