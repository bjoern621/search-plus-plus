import type { FileResult } from "../messages";
import { assert } from "../search/assert";
import { splitEntries } from "../search/globs";
import { relativePath } from "./tree";

// Entries start with `./`, since an entry without it matches at any depth: `docs/` would exclude `src/docs/` as well.

/** The entry that excludes one file, such as `./charts/apim/values.yaml`. */
export function fileEntry(file: Pick<FileResult, "folder" | "name">): string {
  return `./${relativePath(file)}`;
}

/** The entry that excludes a folder and everything below it, such as `./charts/apim/`. Asserts that the folder lies below the workspace folder. */
export function folderEntry(folder: string): string {
  assert(folder !== "", "the workspace folder itself takes no exclude entry");
  return `./${folder}/`;
}

/** Appends `entry` to the text of a files to exclude field. Returns the text unchanged if it holds the entry already. */
export function appendEntry(text: string, entry: string): string {
  const entries = splitEntries(text);
  if (entries.includes(entry)) return text;
  return [...entries, entry].join(", ");
}

/** True when `after` holds every entry of `before`, so filtering the shown results gives what a new search would. */
export function onlyAdded(before: string, after: string): boolean {
  const kept = new Set(splitEntries(after));
  return splitEntries(before).every((entry) => kept.has(entry));
}
