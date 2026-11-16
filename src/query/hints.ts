import type { Query } from "../search/types";
import type { Hint } from "./types";

/**
 * Picks the hint line under the query input.
 * `regexError` carries the message of the regex parser once a regex query fails to compile.
 * Returns undefined for an empty query and for a query that needs no hint.
 */
export function hintFor(query: Query, regexError?: string): Hint | undefined {
  if (query.kind === "regex") {
    if (regexError !== undefined) {
      return {
        text: `The regex cannot compile: ${regexError.trim().replace(/\.$/, "")}. Fix it or drop the slashes.`,
        tone: "info",
        suggestedQuery: query.source,
      };
    }
    return { text: "Searching as a regex.", tone: "highlight" };
  }
  if (query.raw.startsWith("/")) {
    return { text: "End with a slash to search as a regex.", tone: "info", suggestedQuery: `${query.raw}/` };
  }
  if (query.raw === "" || query.keyPathError === undefined) {
    return undefined;
  }
  return { text: query.keyPathError.message, tone: "info" };
}
