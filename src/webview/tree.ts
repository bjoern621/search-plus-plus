import type { CommitInfo, FileIcons, FileResult, ResultLine } from "../messages";
import type { PathFilter } from "../search/globs";

export type Row =
  | { kind: "commit"; key: string; commit: CommitInfo; collapsed: boolean }
  /** `folder` holds the path relative to the workspace folder, empty for a workspace folder of a multi-root workspace. `icon` follows the collapsed state. */
  | { kind: "folder"; key: string; label: string; folder: string; collapsed: boolean; icon: string | undefined }
  | { kind: "file"; key: string; file: FileResult; collapsed: boolean }
  | { kind: "line"; file: FileResult; line: ResultLine };

/** The height of every row, code lines included, as in the explorer and the Search view. */
const ROW_HEIGHT_PX = 22;

interface FolderGroup {
  key: string;
  /** Set in the Git history scope, where every folder group belongs to one commit. */
  commit: CommitInfo | undefined;
  rootIndex: number;
  /** The folder path relative to the workspace folder, split at `/`. */
  segments: string[];
  /** The workspace folder name in a multi-root workspace, then the folder path. Empty for files at the root of a single folder. */
  label: string;
  /** Maps a file URI to its result. */
  files: Map<string, FileResult>;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * Holds the results of one search and lays them out as flat rows.
 * Each folder that holds matched files gets one row with its whole path, so rows need no indentation.
 * Folders follow the folder tree, files their names, lines their numbers.
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
        group = { key, commit: file.commit, rootIndex: file.rootIndex, segments: file.folder === "" ? [] : file.folder.split("/"), label: [file.root, file.folder].filter((part) => part !== "").join("/"), files: new Map() };
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
    for (const group of [...this.groups.values()].sort(compareGroups)) {
      const files = [...group.files.values()].filter((file) => this.shows(file));
      if (files.length === 0) continue;
      if (group.commit && group.commit.sha !== commitSha) {
        commitSha = group.commit.sha;
        const key = `commit:${commitSha}`;
        commitCollapsed = collapsed.has(key);
        rows.push({ kind: "commit", key, commit: group.commit, collapsed: commitCollapsed });
      }
      if (group.commit && commitCollapsed) continue;
      const folderCollapsed = collapsed.has(group.key);
      if (group.label !== "") {
        const icons = files[0]?.icons;
        rows.push({ kind: "folder", key: group.key, label: group.label, folder: group.segments.join("/"), collapsed: folderCollapsed, icon: folderCollapsed ? icons?.folder : icons?.folderExpanded });
      }
      if (folderCollapsed) continue;
      for (const file of files.sort((a, b) => collator.compare(a.name, b.name))) {
        const fileCollapsed = collapsed.has(file.uri);
        rows.push({ kind: "file", key: file.uri, file, collapsed: fileCollapsed });
        if (fileCollapsed) continue;
        for (const block of file.blocks) for (const line of block) rows.push({ kind: "line", file, line });
      }
    }
    return rows;
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

/** Writes a line as the integration tests compare it, such as `match 4:     [tag]: 4.1.0` with the marked parts in brackets. */
export function describeLine(line: ResultLine): string {
  const text = highlightParts(line)
    .map((part) => (part.marked ? `[${part.text}]` : part.text))
    .join("");
  return `${line.match ? "match" : "context"} ${line.line + 1}: ${text}`;
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
