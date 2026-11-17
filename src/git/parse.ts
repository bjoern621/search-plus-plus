// Parsers for the output of the git commands that the Git scopes run.
// Each takes the output as git prints it and holds no state beyond one run.

import type { CommitInfo } from "../messages";
import { assert } from "../search/assert";

export interface TreeEntry {
  mode: string;
  type: string;
  object: string;
  /** Undefined for an entry without a size, such as a submodule. */
  sizeBytes: number | undefined;
  path: string;
}

/** Reads the output of `git ls-tree -r -l -z`. */
export function parseLsTree(output: string): TreeEntry[] {
  const entries: TreeEntry[] = [];
  for (const record of nulList(output)) {
    const tab = record.indexOf("\t");
    if (tab < 0) continue;
    const [mode, type, object, size] = record.slice(0, tab).split(/ +/);
    if (mode === undefined || type === undefined || object === undefined) continue;
    const sizeBytes = size === undefined || size === "-" ? undefined : Number(size);
    entries.push({ mode, type, object, sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : undefined, path: record.slice(tab + 1) });
  }
  return entries;
}

/** Splits output that `-z` separates with NUL bytes. Drops empty entries. */
export function nulList(output: string): string[] {
  return output.split("\0").filter((entry) => entry !== "");
}

export interface BranchEntry {
  /** The short name that `git` takes as a revision, such as `feature` or `origin/feature`. */
  name: string;
  /** The committer date, as `git` writes it relative to now, such as `3 days ago`. */
  relativeDate: string;
  subject: string;
}

/** The format of `git for-each-ref` that `parseBranches` reads. */
export const BRANCH_FORMAT = "%(HEAD)%00%(symref)%00%(refname:short)%00%(committerdate:relative)%00%(subject)";

/** Reads the output of `git for-each-ref --format=BRANCH_FORMAT`. Leaves out the checked-out branch and symbolic refs such as `origin/HEAD`. */
export function parseBranches(output: string): BranchEntry[] {
  const branches: BranchEntry[] = [];
  for (const line of output.split("\n")) {
    const [head, symref, name, relativeDate, subject] = line.split("\0");
    if (name === undefined || name === "" || head === "*" || (symref ?? "") !== "") continue;
    branches.push({ name, relativeDate: relativeDate ?? "", subject: subject ?? "" });
  }
  return branches;
}

/** Undoes the C-style quoting that git puts around a path with unusual characters, such as `"b/caf\303\251.md"`. Returns other text unchanged. */
export function unquoteGitPath(text: string): string {
  if (!text.startsWith('"') || !text.endsWith('"') || text.length < 2) return text;
  const bytes: number[] = [];
  const escapes: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, "\\": 92 };
  const body = text.slice(1, -1);
  for (let i = 0; i < body.length; i++) {
    const char = body[i] as string;
    if (char !== "\\") {
      bytes.push(...Buffer.from(char, "utf8"));
      continue;
    }
    const next = body[i + 1] ?? "";
    const octal = /^[0-7]{3}/.exec(body.slice(i + 1));
    if (octal) {
      bytes.push(parseInt(octal[0], 8));
      i += 3;
      continue;
    }
    bytes.push(escapes[next] ?? next.charCodeAt(0));
    i += 1;
  }
  return Buffer.from(bytes).toString("utf8");
}

/** The `git log` format that `HistoryParser` reads: a NUL, then the hash, short hash, author, author date and subject, each after a NUL. */
export const HISTORY_FORMAT = "%x00%H%x00%h%x00%an%x00%aI%x00%s";

/**
 * The arguments of the `git log` run whose output `HistoryParser` reads, for the latest `commitCount` commits on HEAD below the current folder.
 * They pin every option that a user config could change in that output.
 */
export function historyLogArgs(commitCount: number): string[] {
  return [
    "-c",
    "core.quotePath=false",
    "log",
    `--max-count=${commitCount}`,
    `--format=${HISTORY_FORMAT}`,
    "--patch",
    "--unified=0",
    "--find-renames",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "--no-show-signature",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    "--relative",
    "HEAD",
    "--",
    ".",
  ];
}

export interface ChangedFile {
  /** As `git log --relative` prints it: relative to the folder that git ran in, with `/` as separator. */
  path: string;
  /** 0-based lines of the new file that the commit added or changed, in ascending order. */
  addedLines: number[];
}

export interface ParsedCommit {
  commit: CommitInfo;
  files: ChangedFile[];
}

/**
 * Reads the output of `git log --format=HISTORY_FORMAT --patch --unified=0` line by line.
 * A deleted file and a binary file add no lines and stay out.
 * Hands each commit to `onCommit` once the next one starts or `end` runs.
 */
export class HistoryParser {
  private commit: ParsedCommit | undefined;
  private file: ChangedFile | undefined;
  private inHunk = false;
  /** 0-based line of the new file that the next added or context line of the hunk takes. */
  private nextLine = 0;
  private commitCount = 0;

  constructor(private readonly onCommit: (commit: ParsedCommit) => void) {}

  line(text: string): void {
    if (text.startsWith("\0")) {
      this.startCommit(text);
      return;
    }
    if (!this.commit) return;
    if (text.startsWith("diff --git ")) {
      this.endFile();
      this.file = { path: "", addedLines: [] };
      this.inHunk = false;
      return;
    }
    if (!this.file) return;
    if (this.inHunk && this.readHunkLine(text)) return;
    if (text.startsWith("+++ ")) {
      this.file.path = newPath(text.slice("+++ ".length));
      return;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk) {
      this.inHunk = true;
      this.nextLine = Number(hunk[1]) - 1;
    }
  }

  end(): void {
    this.endCommit();
  }

  /** Reads a line inside a hunk. Returns false for a line that ends the hunk, such as the next hunk header. */
  private readHunkLine(text: string): boolean {
    const marker = text[0];
    if (marker === "+" && this.file) {
      this.file.addedLines.push(this.nextLine++);
      return true;
    }
    if (marker === " ") {
      this.nextLine++;
      return true;
    }
    if (marker === "-" || marker === "\\") return true;
    this.inHunk = false;
    return false;
  }

  private startCommit(text: string): void {
    this.endCommit();
    const [, sha, shortSha, author, date, ...subject] = text.split("\0");
    assert(sha !== undefined && shortSha !== undefined && author !== undefined && date !== undefined, "a commit header must hold the fields of HISTORY_FORMAT");
    this.commit = { commit: { index: this.commitCount++, sha, shortSha, author, date, subject: subject.join("\0") }, files: [] };
  }

  private endFile(): void {
    if (this.commit && this.file && this.file.path !== "" && this.file.addedLines.length > 0) this.commit.files.push(this.file);
    this.file = undefined;
    this.inHunk = false;
  }

  private endCommit(): void {
    this.endFile();
    if (this.commit) this.onCommit(this.commit);
    this.commit = undefined;
  }
}

/** Reads the path after `+++ `, which starts with `b/` or reads `/dev/null` for a deleted file. Returns "" for a deleted file. */
function newPath(text: string): string {
  const path = unquoteGitPath(text.replace(/\t$/, ""));
  if (path === "/dev/null") return "";
  return path.startsWith("b/") ? path.slice(2) : path;
}

export type CatFileObject = { kind: "found"; type: string; bytes: Buffer } | { kind: "missing" };

/**
 * Reads the output of `git cat-file --batch` chunk by chunk.
 * Each object arrives as a header line `<object> <type> <size>`, its bytes and a line feed.
 * An object that git cannot find arrives as `<name> missing` or `<name> ambiguous`.
 */
export class CatFileParser {
  private buffer: Buffer = Buffer.alloc(0);
  /** Set while the bytes of an object are still arriving. */
  private pending: { type: string; sizeBytes: number } | undefined;

  /** Takes the next chunk of output and returns the objects that it completes, in order. */
  push(chunk: Buffer): CatFileObject[] {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    const objects: CatFileObject[] = [];
    for (;;) {
      if (this.pending) {
        if (this.buffer.length < this.pending.sizeBytes + 1) return objects;
        objects.push({ kind: "found", type: this.pending.type, bytes: Buffer.from(this.buffer.subarray(0, this.pending.sizeBytes)) });
        this.buffer = this.buffer.subarray(this.pending.sizeBytes + 1);
        this.pending = undefined;
        continue;
      }
      const end = this.buffer.indexOf(10);
      if (end < 0) return objects;
      const header = this.buffer.subarray(0, end).toString("utf8").split(" ");
      this.buffer = this.buffer.subarray(end + 1);
      const sizeBytes = Number(header[2]);
      if (header.length !== 3 || !Number.isInteger(sizeBytes)) {
        objects.push({ kind: "missing" });
        continue;
      }
      this.pending = { type: header[1] ?? "", sizeBytes };
    }
  }
}
