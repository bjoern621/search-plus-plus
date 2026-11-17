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
  /**
   * True when the row shows `keyPath` after the line text, as for a key of a YAML, JSON or TOML file.
   * A member chain in code shows no key path, since the line spells the chain.
   */
  showKeyPath?: boolean;
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
  /** The row of the workspace folder in a multi-root workspace. */
  root?: FolderIcons;
  /** The rows of the folders above the file, one per folder of its path, the top folder first. */
  folders?: FolderIcons[];
}

export interface FolderIcons {
  collapsed?: string;
  expanded?: string;
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
  /** True while files to include and files to exclude show. */
  fileFieldsOpen: boolean;
  rows: string[];
  /** The icon definition id of each row, empty for a row without icon. */
  icons: string[];
  /** The left edge of the icon slot of each row, null for a row not drawn or without a slot. */
  iconLefts: (number | null)[];
  /** The left edge of the twisty of each drawn tree row and of the line number of each drawn code line. Null for a row not drawn. */
  rowStartLefts: (number | null)[];
  /** The tree lines of each drawn row, a character per column: `│` passes the row, `├` and `└` join it to its parent. Empty for a row without lines, null for a row not drawn. */
  guides: (string | null)[];
  /** Whether each drawn row shows the divider that marks skipped lines above it. Null for a row not drawn. */
  gapsAbove: (boolean | null)[];
  /** The left edge of the label of each folder or file row, null for any other row and a row not drawn. */
  labelLefts: (number | null)[];
  /** The key path that each row shows after its line text, empty for a row without one. */
  keyPaths: string[];
  /** The key path that each drawn row shows, cut to its room. Empty for a drawn row without one, null for a row not drawn. */
  drawnKeyPaths: (string | null)[];
  /** How the key path of each drawn row fits the room after its line text. Null for a row not drawn or without a key path. */
  keyPathRooms: (KeyPathRoom | null)[];
  /** Index of the row drawn with the focus, -1 without one. */
  focused: number;
  /** The reasons and items of the open context menu, `-` for a separator. Empty while the menu stays closed. */
  menu: string[];
  /** The text color of the first match on the focused row, empty without one. */
  focusedMarkColor: string;
  /** The color that the theme sets for a match on a focused list row (list.focusHighlightForeground). */
  focusHighlightColor: string;
  /** The label of the focused item of the context menu, empty while no item holds the focus. */
  menuFocus: string;
  /** The file and the lines of the hover card, as the rows describe them. Empty while no card shows. */
  hover: string[];
  /** Where the hovered line of the card sits against its row. Undefined while no card shows. */
  hoverGeometry: HoverGeometry | undefined;
  /** How the first drawn file row measures. Undefined while the view draws none. */
  fileRowMetrics: RowMetrics | undefined;
  /** How the first drawn code line measures. Undefined while the view draws none. */
  codeLineMetrics: RowMetrics | undefined;
}

/** Widths in pixels, each measured in the page. */
export interface KeyPathRoom {
  /** The space from the end of the line text, plus the gap before a key path, to the end of the row. */
  room: number;
  /** The drawn key path, 0 for a key path that hides. */
  drawn: number;
  /** The cut one step longer than the drawn one, null for a key path drawn whole. */
  longer: number | null;
}

/** Sizes in pixels. */
export interface RowMetrics {
  fontSize: number;
  height: number;
}

/** Positions in pixels from the top left corner of the view. */
export interface HoverGeometry {
  rowTop: number;
  rowRight: number;
  lineTop: number;
  rowTextLeft: number;
  lineTextLeft: number;
  cardTop: number;
  cardBottom: number;
  cardRight: number;
  viewHeight: number;
  viewWidth: number;
  /** The width of the key path in the card header that its end cut hides, 0 for a header without one. */
  headerKeyPathCut: number;
  /** The width of the folder in the card header that its start cut hides. */
  headerFolderCut: number;
}

export type ViewMessage =
  | { type: "ready" }
  | ({ type: "search"; query: string; scope: SearchScope } & FileFields)
  | { type: "cancelSearch" }
  /** Asks for a branch to search. The host answers with `branchPicked` unless the person cancels. */
  | { type: "pickBranch" }
  | { type: "open"; uri: string; line: number; range?: Range; preserveFocus: boolean }
  | { type: "copy"; text: string }
  /** Copies the whole line, since the view holds an excerpt of a long line. */
  | { type: "copyLine"; uri: string; line: number }
  /** Asks for the lines around `line` for the hover card. */
  | { type: "excerpt"; requestId: number; uri: string; line: number }
  | { type: "testSnapshot"; snapshot: TestSnapshot };

/** Workbench settings that the view follows. */
export interface ViewSettings {
  /** `workbench.tree.indent`: how far a tree row steps right of its parent. */
  treeIndentPx: number;
  /** False while `workbench.tree.renderIndentGuides` reads `none`. */
  indentGuides: boolean;
  /** `search.searchOnType`: typing in the query or the file fields searches once typing pauses. */
  searchOnType: boolean;
  /** `search.searchOnTypeDebouncePeriod`: how long typing pauses before the search starts. */
  searchOnTypeDebounceMs: number;
}

export type HostMessage =
  | { type: "focus" }
  | { type: "settings"; settings: ViewSettings }
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
  | ({ type: "testTypeFileFields" } & FileFields)
  | { type: "testTypeQuery"; keys: string[] };
