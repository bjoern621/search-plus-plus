const REPLACEMENT_CHARACTER = "�";

/**
 * Resolves the hex digits of a `\x`, `\u` or `\U` escape in a quoted YAML or TOML key.
 * Returns U+FFFD for a surrogate or a value above U+10FFFF, since neither names a Unicode scalar value.
 */
export function codePointEscape(hexDigits: string): string {
  const codePoint = parseInt(hexDigits, 16);
  const isSurrogate = codePoint >= 0xd800 && codePoint <= 0xdfff;
  if (codePoint > 0x10ffff || isSurrogate) {
    return REPLACEMENT_CHARACTER;
  }
  return String.fromCodePoint(codePoint);
}
