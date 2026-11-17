import type { Hint } from "../query/types";
import type { LineMatch, Query } from "./types";
import type { WalkSettings } from "./walk";

export interface SearchRoot {
  /** Position in the workspace folders. */
  index: number;
  /** Name of the workspace folder in a multi-root workspace, empty with one folder. */
  name: string;
  uri: string;
  /** Path on disk. Undefined for a folder on another file system, such as a virtual one. */
  fsPath: string | undefined;
  walk: WalkSettings;
}

/**
 * Searches all workspace folders in one run, such as one ripgrep process per folder.
 * Built-in engines alone take this shape. The API takes a `SearchEngine`, which searches file by file.
 */
export interface WorkspaceSearchEngine {
  readonly id: string;
  acceptsQuery(query: Query): boolean;
  /** Returns a hint when the query cannot run, such as a regex that does not compile. The search then stops. */
  check(query: Query, signal: AbortSignal): Promise<Hint | undefined>;
  /** Calls `onFile` once per file with matches. `relativePath` uses `/` as separator. */
  search(roots: readonly SearchRoot[], query: Query, signal: AbortSignal, onFile: (root: SearchRoot, relativePath: string, matches: LineMatch[]) => void): Promise<void>;
}
