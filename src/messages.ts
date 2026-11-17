import type { Hint } from "./query/types";
import type { FileFields } from "./search/globs";
import type { GitInfo, SearchScope } from "./search/scope";
import type { MatchReason, Range } from "./search/types";

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
  /** Why a matching default stretched the query on this line. Missing without such a reason. */
  reasons?: MatchReason[];
  /** The key path of the matched node, set by key path engines. */
  keyPath?: string[];
}

export interface CommitInfo {
  sha: string;
  shortSha: string;
  author: string;
  /** The author date in ISO 8601, such as `2026-11-02T14:03:00+01:00`. */
  date: string;
  subject: string;
  /** Position in the log of its repository, 0 for the newest commit. */
  index: number;
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
  /** The commit that changed the file. Set in the Git history scope alone. */
  commit?: CommitInfo;
  /** Set by the view provider from the active file icon theme. */
  icons?: FileIcons;
}

/** Icon definition ids of the active file icon theme. A missing id shows an empty icon slot. */
export interface FileIcons {
  file?: string;
  /** The folder row above the file, collapsed. */
  folder?: string;
  folderExpanded?: string;
}

/** How the view draws an icon definition of the file icon theme. */
export type IconLook =
  /** An SVG or PNG file. With `currentColor`, the image masks the text color of the row. */
  | { kind: "image"; uri: string; currentColor: boolean }
  /** A character of an icon font. `size` holds a CSS font size such as `150%`, relative to the row text. */
  | { kind: "glyph"; character: string; family: string; size: string; color?: string };

export interface IconFontFace {
  family: string;
  sources: { uri: string; format: string }[];
  weight: string;
  style: string;
}

/** The fonts and the icon definitions of the active file icon theme, keyed by definition id. */
export interface IconTable {
  fonts: IconFontFace[];
  icons: Record<string, IconLook>;
}

/**
 * How a search ended.
 * `capped`: the search stopped at `limit` matched lines.
 * `blocked`: the query ran no search, and a hint says why.
 * `noRepository`: the scope reads Git, and no workspace folder lies in a Git repository.
 * `failed`: the search stopped on an error that the output channel names. The results sent before it stay.
 */
export type SearchStatus = "complete" | "capped" | "blocked" | "empty" | "noFolder" | "noRepository" | "failed";

export interface TestSnapshot {
  summary: string;
  hint: string;
  include: string;
  exclude: string;
  rows: string[];
  /** The icon definition id of each row, empty for a row without icon. */
  icons: string[];
  /** Index of the focused row, -1 without one. */
  focused: number;
  /** The reasons and items of the open context menu, `-` for a separator. Empty while the menu stays closed. */
  menu: string[];
  /** The file and the lines of the hover card, as the rows describe them. Empty while no card shows. */
  hover: string[];
}

export type ViewMessage =
  | { type: "ready" }
  | ({ type: "search"; query: string; scope: SearchScope } & FileFields)
  /** Asks for a branch to search. The host answers with `branchPicked` unless the person cancels. */
  | { type: "pickBranch" }
  | { type: "open"; uri: string; line: number; range?: Range; preserveFocus: boolean }
  | { type: "copy"; text: string }
  /** Copies the whole line, since the view holds an excerpt of a long line. */
  | { type: "copyLine"; uri: string; line: number }
  /** Asks for the lines around `line` for the hover card. */
  | { type: "excerpt"; requestId: number; uri: string; line: number }
  | { type: "testSnapshot"; snapshot: TestSnapshot };

export type HostMessage =
  | { type: "focus" }
  | { type: "git"; git: GitInfo }
  | { type: "branchPicked"; branch: string }
  | { type: "searchStarted"; searchId: number }
  | { type: "results"; searchId: number; files: FileResult[] }
  | { type: "hint"; searchId: number; hint: Hint }
  | { type: "searchDone"; searchId: number; status: SearchStatus; limit: number }
  /** Sets the file icon theme and the icons of the files that the view holds, keyed by file URI. Without a theme, rows show empty icon slots. */
  | { type: "icons"; theme: IconTable | undefined; files: Record<string, FileIcons> }
  /** Answers the excerpt request `requestId`. Empty when the file cannot be read. */
  | { type: "excerpt"; requestId: number; lines: ResultLine[] }
  /** Fields left out keep what the view holds. */
  | { type: "testSearch"; query: string; fields?: FileFields; scope?: SearchScope }
  | { type: "testOpenScopeMenu" }
  | { type: "testSnapshot" }
  | { type: "testClickRow"; index: number }
  | { type: "testClickHint" }
  | { type: "testExcludeRow"; index: number }
  | { type: "testPressKeys"; keys: string[] }
  | { type: "testOpenMenu"; index: number }
  | { type: "testHover"; index: number }
  | { type: "testChooseMenuItem"; label: string }
  | ({ type: "testTypeFileFields" } & FileFields);
