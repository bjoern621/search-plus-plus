import type { KeyPathPattern } from "./types";

/** The characters that a literal holds only behind a backslash, since the grammar gives them a meaning. */
const OPERATOR_CHARS = /[.*?[\]{}"\\]/;

/**
 * Says whether a pattern uses the key path language: two or more segments, `**`, `*`, `?`, a class, a group, quotes or an escaped operator.
 * A pattern of one plain word, such as `gateway`, uses none of it.
 * A match of that word reads as a text match, so its row shows no key path.
 */
export function usesKeyPathSyntax(pattern: KeyPathPattern): boolean {
  if (pattern.segments.length > 1) return true;
  return pattern.segments.some((segment) => segment.kind === "globstar" || segment.pieces.some((piece) => piece.kind !== "literal" || OPERATOR_CHARS.test(piece.value)));
}
