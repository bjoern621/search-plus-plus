import type { Range } from "../search/types";

/** The parsed form of a key path. The query parser owns its shape. */
export interface KeyPathPattern {
  segments: unknown[];
}

export interface QueryError {
  /** One sentence for the hint line, such as "The key path skips this query because a bracket ([) stays open. Close it with ]." */
  message: string;
  range: Range;
}
