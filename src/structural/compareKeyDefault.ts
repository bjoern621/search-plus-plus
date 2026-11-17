import { compareWord, foldCaseAndUmlauts } from "../matching";
import { reasonsForFoldedMatch } from "../matching/compareWord";
import type { CompareKey, KeyMatch } from "../query/types";

const DIGITS = /^\d+$/;

/**
 * Compares a key path literal with a key under the matching defaults: case-insensitive, with umlaut variants.
 * A literal that makes up a whole segment also matches a key a few edits away.
 * A literal of digits alone never matches fuzzily, since `items.100` must leave out `items.101`.
 * A quoted literal matches as written.
 */
export const compareKeyDefault: CompareKey = (literal, keyText, how): KeyMatch | undefined => {
  if (how.exact) {
    return compareWord(literal, keyText, true);
  }
  if (how.fuzzy && !DIGITS.test(literal)) {
    return compareWord(literal, keyText, false);
  }
  if (literal === keyText) {
    return { reasons: [] };
  }
  if (foldCaseAndUmlauts(literal) !== foldCaseAndUmlauts(keyText)) {
    return undefined;
  }
  return { reasons: reasonsForFoldedMatch(literal, keyText) };
};
