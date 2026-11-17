import type { HostMessage, ResultLine, SearchStatus, ViewMessage, ViewSettings } from "../messages";
import { hintFor, parseQuery, type Hint } from "../query";
import { type FileFields, PathFilter } from "../search/globs";
import { type GitInfo, type SearchScope, WORKING_TREE } from "../search/scope";
import { appendEntry, fileEntry, folderEntry, onlyAdded } from "./exclusions";
import { ContextMenu } from "./contextMenu";
import { firstFocusableRow, type KeyPress, rowCommand } from "./keyboard";
import { matchMenu, type MenuAction } from "./menu";
import { FileIconTheme } from "./fileIcons";
import { QueryHighlight, renderHint } from "./queryInput";
import { scopeLabel, scopeMenu } from "./scopeMenu";
import { commitDay, highlightParts, resultSummary, ResultTree, type Row, rowAt, rowOffsets } from "./tree";
import { fitKeyPaths, keyPathElement, shownKeys } from "./keyPath";
import { blockDedents, cutToMatch, dedent } from "./codeLines";

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
/** A search adds its query to the history once no other search replaced it for this long, as in the built-in Search view. */
const HISTORY_DELAY_MS = 2000;

const vscode = acquireVsCodeApi();
document.documentElement.dataset.platform = editorPlatform(navigator.userAgent);
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
const scopeLabelElement = document.getElementById("scope-label") as HTMLSpanElement;
const results = document.getElementById("results") as HTMLDivElement;
const rowsElement = document.getElementById("rows") as HTMLDivElement;
const contextMenu = new ContextMenu(document.getElementById("menu") as HTMLDivElement, runMenuAction, () => results.focus());

const tree = new ResultTree();
const iconTheme = new FileIconTheme();
/** Keys of the collapsed folder and file rows. */
const collapsed = new Set<string>();
let searchId = 0;
let status: SearchStatus | "running" | "idle" = "idle";
let cappedAt: number | undefined;
let rows: Row[] = [];
let offsets: number[] = [0];
/** Per row, the columns of indentation that a code line drops. */
let dedents: number[] = [];
let layoutStale = false;
let frame = 0;
/** The hint of the host that stopped the last search. It replaces the hint on the typed query until the text changes. */
let blockedHint: Hint | undefined;
/** The query, fields and scope of the last search, so a change of the fields or the scope can repeat it. */
let searched: ({ query: string; scope: SearchScope } & FileFields) | undefined;
/** What the host found out about Git. Undefined until it answers. */
let git: GitInfo | undefined;
/** The settings of the workbench that the view follows, with their defaults until the host sends them. */
let settings: ViewSettings = { treeIndentPx: 8, searchOnType: true, searchOnTypeDebounceMs: 300 };
let typingTimer = 0;
let historyTimer = 0;
/** Index of the row that holds the keyboard focus inside the results, -1 without one. */
let focusedIndex = -1;
/** Index of the row under the pointer, -1 without one. */
let hoveredIndex = -1;
/** The line whose context menu shows. */
let menuRow: Extract<Row, { kind: "line" }> | undefined;
/** The scroll position at which the context menu opened. A scroll event that leaves it unchanged keeps the menu open. */
let menuScrollTop = 0;

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
  searchOnType();
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
  hoverRow(rowIndexFromEvent(event));
});

results.addEventListener("mouseleave", () => hoverRow(-1));

// The context menu key fires a contextmenu event on the results after the keydown that opened the menu.
results.addEventListener("contextmenu", (event) => {
  if (event.target === results) event.preventDefault();
});

results.addEventListener("scroll", () => {
  if (results.scrollTop !== menuScrollTop) contextMenu.close(false);
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
    case "settings":
      settings = message.settings;
      rowsElement.style.setProperty("--tree-indent", `${message.settings.treeIndentPx}px`);
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
    case "searchDone":
      if (message.searchId !== searchId) return;
      status = message.status;
      cappedAt = message.status === "capped" ? message.limit : undefined;
      invalidateLayout();
      return;
  }
});

vscode.postMessage({ type: "ready" });

function submit(): void {
  const query = input.value;
  searchWithFields(query);
  remember(query);
}

/** Adds `query` to the end of the history, once. */
function remember(query: string): void {
  window.clearTimeout(historyTimer);
  if (query !== "" && state.history.at(-1) !== query) state.history = [...state.history, query].slice(-HISTORY_LIMIT);
  historyIndex = state.history.length;
  saveState();
}

/** Searches for `query` at once. A search that no other search replaces for a while adds its query to the history. */
function searchWithFields(query: string): void {
  window.clearTimeout(typingTimer);
  const fields: FileFields = { include: includeInput.value, exclude: excludeInput.value };
  searched = { query, scope: state.scope, ...fields };
  vscode.postMessage({ type: "search", query, scope: state.scope, ...fields });
  window.clearTimeout(historyTimer);
  historyTimer = window.setTimeout(() => remember(query), HISTORY_DELAY_MS);
}

/**
 * Searches for the query once typing pauses, as the built-in Search view does under `search.searchOnType`.
 * The keystroke cancels the search that runs, since its results no longer fit the fields.
 */
function searchOnType(): void {
  window.clearTimeout(typingTimer);
  if (!settings.searchOnType) return;
  vscode.postMessage({ type: "cancelSearch" });
  typingTimer = window.setTimeout(() => searchWithFields(input.value), settings.searchOnTypeDebounceMs);
}

/**
 * Follows a change of the files to include and exclude fields.
 * A change that only adds exclusions hides their results at once.
 * Any other change searches once typing pauses, since it can bring back files that the last search left out.
 */
function applyFileFields(): void {
  saveState();
  const fields: FileFields = { include: includeInput.value, exclude: excludeInput.value };
  if (searched && fields.include === searched.include && onlyAdded(searched.exclude, fields.exclude)) {
    tree.setFilter(new PathFilter(fields));
    invalidateLayout();
    return;
  }
  searchOnType();
}

/** Adds `entry` to files to exclude and drops its results without a new search. */
function exclude(entry: string): void {
  excludeInput.value = appendEntry(excludeInput.value, entry);
  setFileFieldsOpen(true);
  applyFileFields();
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
  searchOnType();
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
  dedents = blockDedents(rows);
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
  scopeLabelElement.textContent = scopeLabel(state.scope, git);
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
  focusedSubtree = subtreeOf(focusedIndex);
  hoveredSubtree = subtreeOf(hoveredIndex);
  const elements: HTMLElement[] = [];
  for (let index = first; index < last; index++) {
    const row = rows[index];
    if (row) elements.push(rowElement(row, index));
  }
  rowsElement.replaceChildren(...elements);
  cutMatchLines();
  fitKeyPaths(rowsElement.querySelectorAll<HTMLElement>(".key-path"));
}

function rowElement(row: Row, index: number): HTMLElement {
  const element = document.createElement("div");
  element.dataset.index = String(index);
  element.id = `row-${index}`;
  if (index === focusedIndex) element.classList.add("focused");
  if (inSubtree(focusedSubtree, index)) element.classList.add("in-focused");
  if (inSubtree(hoveredSubtree, index)) element.classList.add("in-hovered");
  element.style.top = `${offsets[index] ?? 0}px`;
  element.setAttribute("role", "treeitem");
  switch (row.kind) {
    case "commit":
      element.classList.add("row", "commit");
      element.setAttribute("aria-expanded", String(!row.collapsed));
      element.style.setProperty("--depth", String(row.depth));
      element.title = `${row.commit.sha}\n${row.commit.author}, ${row.commit.date}\n${row.commit.subject}`;
      element.append(twisty(row.collapsed), span("sha", row.commit.shortSha), span("label", row.commit.subject), span("commit-meta", `${row.commit.author}, ${commitDay(row.commit)}`));
      return element;
    case "folder":
      element.classList.add("row");
      element.setAttribute("aria-expanded", String(!row.collapsed));
      element.style.setProperty("--depth", String(row.depth));
      element.title = row.label;
      const icon = iconTheme.folderElement(row.icon);
      element.append(twisty(row.collapsed), ...(icon ? [icon] : []), span("label", row.label));
      if (row.folder !== "") element.append(excludeButton(`Exclude folder ${row.folder}`, folderEntry(row.folder)));
      return element;
    case "file": {
      element.classList.add("row");
      element.setAttribute("aria-expanded", String(!row.collapsed));
      element.style.setProperty("--depth", String(row.depth));
      element.title = [row.file.root, row.file.folder, row.file.name].filter((part) => part !== "").join("/");
      element.append(twisty(row.collapsed), iconTheme.element(row.file.icons?.file), span("label", row.file.name));
      if (row.folded !== "") element.append(span("folded-path", row.folded));
      element.append(excludeButton(`Exclude ${row.file.name}`, fileEntry(row.file)));
      return element;
    }
    case "line": {
      element.classList.add("line");
      if (row.line.match) element.classList.add("match");
      if (skipsLines(index)) element.classList.add("after-gap");
      const text = span("text", "");
      fillLineText(text, dedent(row.line, dedents[index] ?? 0), row.line.offset > 0 ? "…" : "");
      element.append(span("number", String(row.line.line + 1)), text);
      const keys = shownKeys(row.line);
      if (keys) element.append(keyPathElement(keys));
      return element;
    }
  }
}

function fillLineText(text: HTMLElement, line: ResultLine, lead: string): void {
  text.replaceChildren(lead);
  for (const part of highlightParts(line)) {
    if (part.marked) text.append(span("mark", part.text, "mark"));
    else text.append(part.text);
  }
}

/** Cuts the start of each match line in view whose first match ends past the edge of its row, so the match shows. A resize renders again and cuts anew. */
function cutMatchLines(): void {
  for (const element of rowsElement.querySelectorAll<HTMLElement>(".line.match")) {
    const text = element.querySelector<HTMLElement>(".text");
    const mark = text?.querySelector<HTMLElement>(".mark");
    if (!text || !mark?.textContent) continue;
    const markBox = mark.getBoundingClientRect();
    if (markBox.right <= text.getBoundingClientRect().right + 0.5) continue;
    const index = Number(element.dataset.index);
    const row = rows[index];
    if (row?.kind !== "line") continue;
    const charWidth = markBox.width / mark.textContent.length;
    const cut = cutToMatch(dedent(row.line, dedents[index] ?? 0), Math.floor(text.clientWidth / charWidth));
    if (cut) fillLineText(text, cut, "");
  }
}

/** True for a code line whose number does not follow the code line above it in the same file. */
function skipsLines(index: number): boolean {
  const row = rows[index];
  const above = rows[index - 1];
  if (row?.kind !== "line" || above?.kind !== "line" || above.file !== row.file) return false;
  return row.line.line !== above.line.line + 1;
}

/** The rows below a folder, file or commit row, which take its hover and its selection. */
interface Subtree {
  first: number;
  last: number;
}

let focusedSubtree: Subtree | undefined;
let hoveredSubtree: Subtree | undefined;

/** Finds the rows below the row at `index`. Undefined for a code line and for a collapsed row. */
function subtreeOf(index: number): Subtree | undefined {
  const row = rows[index];
  if (!row || row.kind === "line") return undefined;
  let last = index;
  while (last + 1 < rows.length && (rows[last + 1]?.depth ?? 0) > row.depth) last++;
  return last > index ? { first: index + 1, last } : undefined;
}

function inSubtree(subtree: Subtree | undefined, index: number): boolean {
  return subtree !== undefined && index >= subtree.first && index <= subtree.last;
}

/** Lights the rows below the row under the pointer, on the rows in view, without a render. */
function hoverRow(index: number): void {
  if (index === hoveredIndex) return;
  hoveredIndex = index;
  hoveredSubtree = subtreeOf(index);
  for (const element of rowsElement.querySelectorAll<HTMLElement>("[data-index]")) {
    element.classList.toggle("in-hovered", inSubtree(hoveredSubtree, Number(element.dataset.index)));
  }
}

/** A button that adds `entry` to files to exclude, drawn as a circle with a slash. */
function excludeButton(label: string, entry: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "icon exclude";
  button.tabIndex = -1;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.dataset.entry = entry;
  button.append(codicon("circle-slash"));
  return button;
}

/** A chevron that points down below an expanded row and right beside a collapsed one, as the twisties of the workbench trees. */
function twisty(collapsed: boolean): HTMLElement {
  const element = codicon(collapsed ? "chevron-right" : "chevron-down");
  element.classList.add("twisty");
  return element;
}

function codicon(name: string): HTMLElement {
  const element = document.createElement("span");
  element.className = `codicon codicon-${name}`;
  element.setAttribute("aria-hidden", "true");
  return element;
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
  contextMenu.open(matchMenu(row.file, row.line, searched?.query ?? input.value), element.getBoundingClientRect(), fromKeyboard);
  return true;
}

/** Opens the scope menu below the scope button. */
function openScopeMenu(fromKeyboard: boolean): void {
  menuRow = undefined;
  menuScrollTop = results.scrollTop;
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

/** Picks the platform as the VS Code renderer does, which decides the default fonts of the editor. */
function editorPlatform(userAgent: string): "mac" | "windows" | "linux" {
  if (userAgent.includes("Macintosh")) return "mac";
  if (userAgent.includes("Windows")) return "windows";
  return "linux";
}
