import type { CommitInfo } from "../messages";
import type { SearchRoot } from "./workspaceEngine";

/** A file as a branch or a commit holds it, read from Git. */
export interface RevisionFile {
  root: SearchRoot;
  /** Relative to the workspace folder, with `/` as separator. */
  relativePath: string;
  uri: string;
  text: string;
  /** The 0-based lines that a match may lie on, in the history scope the lines that the commit added or changed. Missing: every line. */
  matchableLines?: ReadonlySet<number>;
  commit?: CommitInfo;
}

/** Decides whether a file of a root takes part in the search. */
export type PathTest = (root: SearchRoot, relativePath: string) => boolean;

/** Lists and reads the files of a scope that Git holds, in batches, so a large tree never sits in memory at once. */
export interface RevisionSource {
  /** Yields the files that `accepts` lets pass. Stops once `signal` aborts. */
  batches(accepts: PathTest, signal: AbortSignal): AsyncIterable<RevisionFile[]>;
}
