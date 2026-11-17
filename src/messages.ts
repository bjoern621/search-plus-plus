import type { Hint } from "./query/types";
import type { FileFields } from "./search/globs";
import type { Range } from "./search/types";

export interface ResultLine {
  /** 0-based line number. */
  line: number;
  /** The line, or an excerpt of it starting at `offset` when the line runs long. */
  text: string;
  offset: number;
  /** False on a context line. A matched line can hold no range, as a match of the empty regex `^` does. */
  match: boolean;
  /** Matched ranges in offsets of the whole line. */
  ranges: Range[];
}

export interface FileResult {
  uri: string;
  /** Position of the workspace folder, so roots keep the order of the workspace. */
  rootIndex: number;
  /** Name of the workspace folder in a multi-root workspace, empty with one folder. */
  root: string;
  /** Folder of the file relative to its workspace folder, with `/` as separator. Empty at the root. */
  folder: string;
  name: string;
  languageId: string;
  matchCount: number;
  /** Runs of consecutive lines in ascending order. Context of close matches shares one block. */
  blocks: ResultLine[][];
}

/**
 * How a search ended.
 * `capped`: the search stopped at `limit` matched lines.
 * `blocked`: the query ran no search, and a hint says why.
 */
export type SearchStatus = "complete" | "capped" | "blocked" | "empty" | "noFolder";

export interface TestSnapshot {
  summary: string;
  hint: string;
  include: string;
  exclude: string;
  rows: string[];
  /** Index of the focused row, -1 without one. */
  focused: number;
}

export type ViewMessage =
  | { type: "ready" }
  | ({ type: "search"; query: string } & FileFields)
  | { type: "open"; uri: string; line: number; range?: Range; preserveFocus: boolean }
  | { type: "testSnapshot"; snapshot: TestSnapshot };

export type HostMessage =
  | { type: "focus" }
  | { type: "searchStarted"; searchId: number }
  | { type: "results"; searchId: number; files: FileResult[] }
  | { type: "hint"; searchId: number; hint: Hint }
  | { type: "searchDone"; searchId: number; status: SearchStatus; limit: number }
  /** Fields left out keep what the view holds. */
  | { type: "testSearch"; query: string; fields?: FileFields }
  | { type: "testSnapshot" }
  | { type: "testClickRow"; index: number }
  | { type: "testClickHint" }
  | { type: "testExcludeRow"; index: number }
  | { type: "testPressKeys"; keys: string[] }
  | ({ type: "testTypeFileFields" } & FileFields);
