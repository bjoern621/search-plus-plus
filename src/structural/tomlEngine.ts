import type { FileInfo, LineMatch, Query, SearchEngine, SearchFile } from "../search/types";
import { compareKeyDefault } from "./compareKeyDefault";
import { isFileOfKind, keyPathOf, TOML_FILES } from "./fileKinds";
import { KeyPathCollector, SearchAborted } from "./keyPathCollector";
import { readTomlKeys } from "./tomlKeys";

/**
 * Finds key paths in TOML files.
 * Every key as written counts as an occurrence of its node.
 * `[a.b]` and `[a.c]` both hold the node `a`, so `a` matches on both lines.
 * An array of tables numbers its tables from 0: the second `[[products]]` holds `products.1`.
 */
export const tomlEngine: SearchEngine = {
  id: "tomlKeyPath",

  accepts(file: FileInfo, query: Query): boolean {
    return keyPathOf(query) !== undefined && isFileOfKind(file, TOML_FILES);
  },

  search(file: SearchFile, query: Query, signal: AbortSignal): LineMatch[] {
    const pattern = keyPathOf(query);
    if (pattern === undefined) {
      return [];
    }
    const collector = new KeyPathCollector(file.text, pattern, compareKeyDefault, signal);
    try {
      readTomlKeys(file.text, (keys, start, end) => collector.visit(keys, start, end));
    } catch (error) {
      if (error instanceof SearchAborted) {
        return [];
      }
      throw error;
    }
    return collector.results();
  },
};
