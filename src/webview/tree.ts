import type { FileResult, ResultLine } from "../messages";

export type Row =
  | { kind: "folder"; key: string; label: string; collapsed: boolean }
  | { kind: "file"; key: string; file: FileResult; collapsed: boolean }
  | { kind: "line"; file: FileResult; line: ResultLine };

export const ROW_HEIGHT_PX: Record<Row["kind"], number> = { folder: 22, file: 22, line: 18 };

interface FolderGroup {
  key: string;
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
 */
export class ResultTree {
  /** Maps a folder key to its group. */
  private readonly groups = new Map<string, FolderGroup>();
  private matches = 0;
  private files = 0;

  get matchCount(): number {
    return this.matches;
  }

  get fileCount(): number {
    return this.files;
  }

  /** Adds files to the tree. A file already in it gets replaced. */
  add(results: readonly FileResult[]): void {
    for (const file of results) {
      const key = `${file.rootIndex}:${file.folder}`;
      let group = this.groups.get(key);
      if (!group) {
        group = { key, rootIndex: file.rootIndex, segments: file.folder === "" ? [] : file.folder.split("/"), label: [file.root, file.folder].filter((part) => part !== "").join("/"), files: new Map() };
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

  clear(): void {
    this.groups.clear();
    this.matches = 0;
    this.files = 0;
  }

  /** Lays out the rows. `collapsed` holds the keys of collapsed folder and file rows. */
  rows(collapsed: ReadonlySet<string>): Row[] {
    const rows: Row[] = [];
    for (const group of [...this.groups.values()].sort(compareGroups)) {
      const folderCollapsed = collapsed.has(group.key);
      if (group.label !== "") rows.push({ kind: "folder", key: group.key, label: group.label, collapsed: folderCollapsed });
      if (folderCollapsed) continue;
      for (const file of [...group.files.values()].sort((a, b) => collator.compare(a.name, b.name))) {
        const fileCollapsed = collapsed.has(file.uri);
        rows.push({ kind: "file", key: file.uri, file, collapsed: fileCollapsed });
        if (fileCollapsed) continue;
        for (const block of file.blocks) for (const line of block) rows.push({ kind: "line", file, line });
      }
    }
    return rows;
  }
}

/** A parent folder sorts before its subfolders, so the rows follow the folder tree. */
function compareGroups(a: FolderGroup, b: FolderGroup): number {
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
  const offsets = [0];
  for (const row of rows) offsets.push((offsets.at(-1) ?? 0) + ROW_HEIGHT_PX[row.kind]);
  return offsets;
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

/** Builds the summary line, such as "4 results in 4 files". */
export function resultSummary(matchCount: number, fileCount: number, cappedAt?: number): string {
  if (matchCount === 0) return "No results.";
  const files = `${fileCount.toLocaleString("en-US")} ${fileCount === 1 ? "file" : "files"}`;
  if (cappedAt !== undefined) return `Showing the first ${cappedAt.toLocaleString("en-US")} results in ${files}`;
  return `${matchCount.toLocaleString("en-US")} ${matchCount === 1 ? "result" : "results"} in ${files}`;
}
