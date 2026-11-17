import type { CommitInfo, FileIcons, FileResult, ResultLine } from "../messages";
import type { PathFilter } from "../search/globs";

/**
 * How a tree row hangs from its parent: └ for the last child, ├ for any other, in the column of the parent.
 * `through` holds one entry per column left of that, true where an ancestor has a child further down, so its line passes the row.
 */
export interface TreeLines {
  last: boolean;
  through: boolean[];
}

/** `depth` counts the tree rows that a row hangs from: 0 at the top, 1 below a row at the top, and so on. */
export type Row =
  | { kind: "commit"; key: string; depth: number; lines: TreeLines; commit: CommitInfo; collapsed: boolean }
  /**
   * `label` joins the names of a compacted chain of folders, such as `charts/apim`.
   * `folder` holds the path relative to the workspace folder, empty for a workspace folder of a multi-root workspace. `icon` follows the collapsed state.
   */
  | { kind: "folder"; key: string; depth: number; lines: TreeLines; label: string; folder: string; collapsed: boolean; icon: string | undefined }
  /**
   * `folded` holds the chain of folders that leads to this file alone and folds into its row, such as `argocd/applications/gitlab`.
   * It stays empty for a file that shares its folder row with other results.
   */
  | { kind: "file"; key: string; depth: number; lines: TreeLines; file: FileResult; folded: string; collapsed: boolean }
  | { kind: "line"; depth: number; file: FileResult; line: ResultLine };

/** A folder of the results with the matched files right in it and the folders below it that hold some. */
interface FolderNode {
  /** The path relative to the workspace folder, empty for the workspace folder. */
  path: string;
  name: string;
  /** Maps a folder name to its node. */
  folders: Map<string, FolderNode>;
  files: FileResult[];
}

/** The height of every row, code lines included, as in the explorer and the Search view. */
const ROW_HEIGHT_PX = 22;

interface FolderGroup {
  key: string;
  /** Set in the Git history scope, where every folder group belongs to one commit. */
  commit: CommitInfo | undefined;
  rootIndex: number;
  /** The folder path relative to the workspace folder, split at `/`. */
  segments: string[];
  /** Maps a file URI to its result. */
  files: Map<string, FileResult>;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * Holds the results of one search and lays them out as flat rows.
 * Folders nest as in the explorer.
 * A chain of folders without matched files of their own shares one row, such as `charts/apim`.
 * A chain that leads to one file and nothing else folds into the row of that file, so a lone file costs one row.
 * Inside a folder, its subfolders come first, then its files, each sorted by name. Lines follow their numbers.
 * In the Git history scope, a row per commit heads the folders of that commit, the newest commit first.
 */
export class ResultTree {
  /** Maps a folder key to its group. */
  private readonly groups = new Map<string, FolderGroup>();
  private matches = 0;
  private files = 0;
  /** Hides the files that it rejects, so an exclusion drops results without a new search. */
  private filter: PathFilter | undefined;

  /** Counts the matches of the files that the filter lets pass. */
  get matchCount(): number {
    if (!this.filter) return this.matches;
    return this.shownFiles().reduce((sum, file) => sum + file.matchCount, 0);
  }

  get fileCount(): number {
    if (!this.filter) return this.files;
    return this.shownFiles().length;
  }

  /** Counts the commits that hold a file that the filter lets pass. Zero outside the Git history scope. */
  get commitCount(): number {
    return new Set(this.shownFiles().flatMap((file) => (file.commit ? [file.commit.sha] : []))).size;
  }

  /** Hides the files that `filter` rejects. `undefined` shows every file. */
  setFilter(filter: PathFilter | undefined): void {
    this.filter = filter;
  }

  /** Adds files to the tree. A file already in it gets replaced. */
  add(results: readonly FileResult[]): void {
    for (const file of results) {
      const folderKey = `${file.rootIndex}:${file.folder}`;
      const key = file.commit ? `${file.commit.sha}:${folderKey}` : folderKey;
      let group = this.groups.get(key);
      if (!group) {
        group = { key, commit: file.commit, rootIndex: file.rootIndex, segments: file.folder === "" ? [] : file.folder.split("/"), files: new Map() };
        this.groups.set(key, group);
      }
      const replaced = group.files.get(file.uri);
      if (replaced) {
        this.matches -= replaced.matchCount;
        this.files--;
      }
      group.files.set(file.uri, file);
      this.matches += file.matchCount;
      this.files++;
    }
  }

  /** Replaces the icons of the files that `icons` names, keyed by file URI. */
  setIcons(icons: Readonly<Record<string, FileIcons>>): void {
    for (const group of this.groups.values()) {
      for (const [uri, file] of group.files) {
        const replacement = icons[uri];
        if (replacement) group.files.set(uri, { ...file, icons: replacement });
      }
    }
  }

  /** Empties the tree and drops its filter. */
  clear(): void {
    this.groups.clear();
    this.filter = undefined;
    this.matches = 0;
    this.files = 0;
  }

  /** Lays out the rows. `collapsed` holds the keys of collapsed commit, folder and file rows. */
  rows(collapsed: ReadonlySet<string>): Row[] {
    const rows: Row[] = [];
    let commitSha: string | undefined;
    let commitCollapsed = false;
    for (const [rootKey, root] of this.workspaceFolders()) {
      const commit = firstFile(root)?.commit;
      if (commit && commit.sha !== commitSha) {
        commitSha = commit.sha;
        const key = `commit:${commitSha}`;
        commitCollapsed = collapsed.has(key);
        rows.push({ kind: "commit", key, depth: 0, lines: unjoined(), commit, collapsed: commitCollapsed });
      }
      if (commit && commitCollapsed) continue;
      const depth = commit ? 1 : 0;
      const rootName = firstFile(root)?.root ?? "";
      if (rootName === "") {
        pushChildren(rows, root, rootKey, depth, collapsed);
        continue;
      }
      const key = `${rootKey}:`;
      const rootCollapsed = collapsed.has(key);
      const icons = firstFile(root)?.icons?.root;
      rows.push({ kind: "folder", key, depth, lines: unjoined(), label: rootName, folder: "", collapsed: rootCollapsed, icon: rootCollapsed ? icons?.collapsed : icons?.expanded });
      if (!rootCollapsed) pushChildren(rows, root, rootKey, depth + 1, collapsed);
    }
    joinTreeLines(rows);
    return rows;
  }

  /**
   * Builds the folder tree of the shown files, one per workspace folder, keyed as folder rows key their paths.
   * In the Git history scope each commit gets a tree of its own per workspace folder, in the order of the log.
   */
  private workspaceFolders(): Map<string, FolderNode> {
    const roots = new Map<string, FolderNode>();
    for (const group of [...this.groups.values()].sort(compareGroups)) {
      const files = [...group.files.values()].filter((file) => this.shows(file));
      if (files.length === 0) continue;
      const rootKey = group.commit ? `${group.commit.sha}:${group.rootIndex}` : String(group.rootIndex);
      let node: FolderNode | undefined = roots.get(rootKey);
      if (!node) {
        node = folderNode("", "");
        roots.set(rootKey, node);
      }
      for (const [index, name] of group.segments.entries()) {
        let child: FolderNode | undefined = node.folders.get(name);
        if (!child) {
          child = folderNode(group.segments.slice(0, index + 1).join("/"), name);
          node.folders.set(name, child);
        }
        node = child;
      }
      node.files.push(...files);
    }
    return roots;
  }

  private shows(file: FileResult): boolean {
    return this.filter?.accepts(relativePath(file)) ?? true;
  }

  private shownFiles(): FileResult[] {
    return [...this.groups.values()].flatMap((group) => [...group.files.values()].filter((file) => this.shows(file)));
  }
}

/** The path of a file relative to its workspace folder. */
export function relativePath(file: Pick<FileResult, "folder" | "name">): string {
  return file.folder === "" ? file.name : `${file.folder}/${file.name}`;
}

function folderNode(path: string, name: string): FolderNode {
  return { path, name, folders: new Map(), files: [] };
}

/** The first file in or below `node`, in the order of the rows. */
function firstFile(node: FolderNode): FileResult | undefined {
  for (const folder of sortedFolders(node)) {
    const file = firstFile(folder);
    if (file) return file;
  }
  return sortedFiles(node)[0];
}

function sortedFolders(node: FolderNode): FolderNode[] {
  return [...node.folders.values()].sort((a, b) => collator.compare(a.name, b.name));
}

function sortedFiles(node: FolderNode): FileResult[] {
  return [...node.files].sort((a, b) => collator.compare(a.name, b.name));
}

/** Lines for a row before `joinTreeLines` places it. */
function unjoined(): TreeLines {
  return { last: true, through: [] };
}

/** Lays out the subfolders of `node`, then its files, at `depth`. `rootKey` names the workspace folder and, in the Git history scope, the commit. */
function pushChildren(rows: Row[], node: FolderNode, rootKey: string, depth: number, collapsed: ReadonlySet<string>): void {
  for (const folder of sortedFolders(node)) pushFolder(rows, folder, rootKey, depth, collapsed);
  for (const file of sortedFiles(node)) pushFile(rows, file, "", depth, collapsed);
}

function pushFile(rows: Row[], file: FileResult, folded: string, depth: number, collapsed: ReadonlySet<string>): void {
  const fileCollapsed = collapsed.has(file.uri);
  rows.push({ kind: "file", key: file.uri, depth, lines: unjoined(), file, folded, collapsed: fileCollapsed });
  if (fileCollapsed) return;
  for (const block of file.blocks) {
    for (const line of block) if (!isBlankContext(line)) rows.push({ kind: "line", depth: depth + 1, file, line });
  }
}

/** A context line of whitespace alone takes no row. */
function isBlankContext(line: ResultLine): boolean {
  return line.ranges.length === 0 && line.text.trim() === "";
}

/**
 * A folder without files of its own and with one subfolder shares its row with that subfolder, as the built-in Search view compacts them.
 * A chain that ends in a folder holding one file and no subfolder takes no row: it folds into the row of that file.
 */
function pushFolder(rows: Row[], folder: FolderNode, rootKey: string, depth: number, collapsed: ReadonlySet<string>): void {
  const names = [folder.name];
  let last = folder;
  for (let only = soleSubfolder(last); only; only = soleSubfolder(last)) {
    names.push(only.name);
    last = only;
  }
  const [loneFile] = last.files;
  if (loneFile && last.files.length === 1 && last.folders.size === 0) {
    pushFile(rows, loneFile, names.join("/"), depth, collapsed);
    return;
  }
  const key = `${rootKey}:${last.path}`;
  const folderCollapsed = collapsed.has(key);
  const icons = firstFile(last)?.icons?.folders?.[last.path.split("/").length - 1];
  rows.push({ kind: "folder", key, depth, lines: unjoined(), label: names.join("/"), folder: last.path, collapsed: folderCollapsed, icon: folderCollapsed ? icons?.collapsed : icons?.expanded });
  if (!folderCollapsed) pushChildren(rows, last, rootKey, depth + 1, collapsed);
}

function soleSubfolder(node: FolderNode): FolderNode | undefined {
  if (node.files.length > 0 || node.folders.size !== 1) return undefined;
  return node.folders.values().next().value;
}

/**
 * Sets the lines of each commit, folder and file row from the depths of the rows.
 * A row comes last among its siblings once no row at its depth follows before a row above that depth.
 * Code lines draw no lines, so a line of the tree pauses where they sit.
 */
function joinTreeLines(rows: readonly Row[]): void {
  const laterSibling: boolean[] = [];
  for (let index = rows.length - 1; index >= 0; index--) {
    const row = rows[index];
    if (!row || row.kind === "line") continue;
    row.lines.last = laterSibling[row.depth] !== true;
    laterSibling[row.depth] = true;
    laterSibling.length = row.depth + 1;
  }
  const open: boolean[] = [];
  for (const row of rows) {
    if (row.kind === "line") continue;
    row.lines.through = open.slice(1, row.depth);
    open[row.depth] = !row.lines.last;
    open.length = row.depth + 1;
  }
}

/** Commits keep the order of the log. Inside one, a parent folder sorts before its subfolders, so the rows follow the folder tree. */
function compareGroups(a: FolderGroup, b: FolderGroup): number {
  const commitOrder = (a.commit?.index ?? 0) - (b.commit?.index ?? 0);
  if (commitOrder !== 0) return commitOrder;
  if (a.commit?.sha !== b.commit?.sha) return (a.commit?.sha ?? "") < (b.commit?.sha ?? "") ? -1 : 1;
  if (a.rootIndex !== b.rootIndex) return a.rootIndex - b.rootIndex;
  const shared = Math.min(a.segments.length, b.segments.length);
  for (let i = 0; i < shared; i++) {
    const order = collator.compare(a.segments[i] ?? "", b.segments[i] ?? "");
    if (order !== 0) return order;
  }
  return a.segments.length - b.segments.length;
}

/** Returns the top offset of each row in pixels, plus the total height as the last entry. */
export function rowOffsets(rows: readonly Row[]): number[] {
  return Array.from({ length: rows.length + 1 }, (_, index) => index * ROW_HEIGHT_PX);
}

/** Returns the index of the row that covers `top`, found by binary search over `offsets`. */
export function rowAt(offsets: readonly number[], top: number): number {
  let low = 0;
  let high = offsets.length - 2;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((offsets[middle] ?? 0) <= top) low = middle;
    else high = middle - 1;
  }
  return Math.max(0, low);
}

/** Splits an excerpt into plain and marked parts. Ranges count offsets of the whole line, so they shift by the excerpt offset. */
export function highlightParts(line: ResultLine): { text: string; marked: boolean }[] {
  const parts: { text: string; marked: boolean }[] = [];
  let cursor = 0;
  for (const range of line.ranges) {
    const start = Math.min(Math.max(range.start - line.offset, cursor), line.text.length);
    const end = Math.min(Math.max(range.end - line.offset, start), line.text.length);
    if (start > cursor) parts.push({ text: line.text.slice(cursor, start), marked: false });
    if (end > start) parts.push({ text: line.text.slice(start, end), marked: true });
    cursor = end;
  }
  if (cursor < line.text.length) parts.push({ text: line.text.slice(cursor), marked: false });
  return parts;
}

/** Builds the summary line, such as "4 results in 4 files". The Git history scope counts commits in place of files: "4 results in 2 commits". */
export function resultSummary(matchCount: number, fileCount: number, cappedAt?: number, commitCount?: number): string {
  if (matchCount === 0) return "No results.";
  const files = commitCount === undefined ? count(fileCount, "file", "files") : count(commitCount, "commit", "commits");
  if (cappedAt !== undefined) return `Showing the first ${cappedAt.toLocaleString("en-US")} results in ${files}`;
  return `${matchCount.toLocaleString("en-US")} ${matchCount === 1 ? "result" : "results"} in ${files}`;
}

function count(value: number, one: string, many: string): string {
  return `${value.toLocaleString("en-US")} ${value === 1 ? one : many}`;
}

/** Writes the author date as the day it fell on, such as `2026-11-02`. */
export function commitDay(commit: CommitInfo): string {
  return commit.date.slice(0, 10);
}
