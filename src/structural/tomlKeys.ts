/**
 * Reads the keys of TOML: table headers, arrays of tables, dotted keys, arrays and inline tables.
 * Scalar values stay unread, since key paths need none of them.
 * The reader never throws.
 * A line that breaks the grammar gets skipped, so the rest of the file keeps its keys.
 * It replaces a full TOML parser, which takes about half a second on a 1 MB lockfile.
 */

/** Receives a node with its key path and the file offsets of the text to highlight. It may keep `keys` during the call alone. */
export type VisitKey = (keys: string[], start: number, end: number) => void;

interface KeyPart {
  name: string;
  start: number;
  end: number;
}

/** The bare key characters of TOML 1.1. */
const BARE_KEY_CHAR = /[A-Za-z0-9_\-²³¹¼-¾À-ÖØ-öø-ͽͿ-῿‌‍‿⁀⁰-↏①-⓿Ⰰ-⿯、-퟿豈-﷏ﷰ-�]/;

/**
 * Visits every key in the file.
 * Every key as written counts as an occurrence of its node: `[a.b]` and `[a.c]` both visit `a`.
 * An array of tables numbers its tables from 0, so the second `[[bin]]` visits `bin.1` at its key.
 */
export function readTomlKeys(text: string, visit: VisitKey): void {
  new TomlReader(text, visit).read();
}

class TomlReader {
  private pos = 0;
  /** The resolved path of the current table, array indices included. Undefined below a broken header, whose keys stay unread. */
  private table: string[] | undefined = [];
  /** Maps the resolved path of an array of tables, joined with NUL, to the count of its tables. */
  private readonly arrayTableCounts = new Map<string, number>();
  private readonly keys: string[] = [];

  constructor(
    private readonly text: string,
    private readonly visit: VisitKey,
  ) {}

  read(): void {
    while (this.pos < this.text.length) {
      const start = this.skipBlanks(this.pos);
      const char = this.text[start];
      if (char === "[") {
        this.header(start);
      } else if (this.table !== undefined && char !== "#" && char !== "\n" && char !== "\r" && char !== undefined) {
        this.keyValue(start, this.table);
      }
      this.pos = this.nextLineStart(Math.max(this.pos, start));
    }
  }

  /** Reads `[a.b]` or `[[a.b]]` and makes it the current table. */
  private header(open: number): void {
    const isArray = this.text[open + 1] === "[";
    const parsed = this.dottedKey(this.skipBlanks(open + (isArray ? 2 : 1)));
    const close = parsed === undefined ? -1 : this.skipBlanks(parsed.end);
    if (parsed === undefined || !this.text.startsWith(isArray ? "]]" : "]", close)) {
      this.table = undefined;
      return;
    }
    const resolved: string[] = [];
    parsed.parts.forEach((part, i) => {
      resolved.push(part.name);
      this.visit(resolved, part.start, part.end);
      const arrayKey = resolved.join("\u0000");
      const isLast = i === parsed.parts.length - 1;
      if (isLast && isArray) {
        const index = this.arrayTableCounts.get(arrayKey) ?? 0;
        this.arrayTableCounts.set(arrayKey, index + 1);
        resolved.push(String(index));
        this.visit(resolved, part.start, part.end);
        return;
      }
      const count = this.arrayTableCounts.get(arrayKey);
      if (!isLast && count !== undefined) {
        // A header below an array of tables continues its last table, as `[bin.extra]` does after `[[bin]]`.
        resolved.push(String(count - 1));
      }
    });
    this.table = resolved;
  }

  /** Reads `a.b = value` below `prefix` and visits each part of the key, then the keys inside the value. Returns the offset after the value. */
  private keyValue(start: number, prefix: string[]): number {
    const parsed = this.dottedKey(start);
    if (parsed === undefined) {
      return start;
    }
    const equals = this.skipBlanks(parsed.end);
    if (this.text[equals] !== "=") {
      return start;
    }
    this.keys.length = 0;
    this.keys.push(...prefix);
    for (const part of parsed.parts) {
      this.keys.push(part.name);
      this.visit(this.keys, part.start, part.end);
    }
    const end = this.value(this.skipBlanks(equals + 1));
    this.keys.length = 0;
    this.keys.push(...prefix);
    return end;
  }

  /** Reads a value at `start` and visits the keys inside it. Returns the offset after the value. */
  private value(start: number): number {
    const text = this.text;
    const char = text[start];
    if (char === "[") {
      return this.array(start);
    }
    if (char === "{") {
      return this.inlineTable(start);
    }
    if (char === '"' || char === "'") {
      return this.stringEnd(start);
    }
    let at = start;
    while (at < text.length && !",]}#\n\r".includes(text[at]!)) {
      at++;
    }
    let end = at;
    while (end > start && (text[end - 1] === " " || text[end - 1] === "\t")) {
      end--;
    }
    return end;
  }

  private array(open: number): number {
    const prefix = [...this.keys];
    let index = 0;
    let at = open + 1;
    for (;;) {
      at = this.skipBlanksAndComments(at);
      const char = this.text[at];
      if (char === undefined || char === "]") {
        this.pos = Math.max(this.pos, at);
        return char === undefined ? at : at + 1;
      }
      if (char === ",") {
        at++;
        continue;
      }
      this.keys.length = 0;
      this.keys.push(...prefix, String(index++));
      const end = this.value(at);
      this.visit(this.keys, at, end);
      this.keys.length = 0;
      this.keys.push(...prefix);
      at = end > at ? end : at + 1;
    }
  }

  private inlineTable(open: number): number {
    const prefix = [...this.keys];
    let at = open + 1;
    for (;;) {
      at = this.skipBlanksAndComments(at);
      const char = this.text[at];
      if (char === undefined || char === "}") {
        this.pos = Math.max(this.pos, at);
        return char === undefined ? at : at + 1;
      }
      if (char === ",") {
        at++;
        continue;
      }
      const end = this.keyValue(at, prefix);
      this.keys.length = 0;
      this.keys.push(...prefix);
      at = end > at ? end : this.skipPastBrokenEntry(at);
    }
  }

  /** Skips an inline table entry that is no `key = value`, up to the next `,` or `}`. */
  private skipPastBrokenEntry(start: number): number {
    let at = start;
    while (at < this.text.length && this.text[at] !== "," && this.text[at] !== "}") {
      at++;
    }
    return at;
  }

  /** Reads `a."b.c".'d'` with blanks around the dots. Returns undefined when no key starts at `start`. */
  private dottedKey(start: number): { parts: KeyPart[]; end: number } | undefined {
    const parts: KeyPart[] = [];
    let at = start;
    for (;;) {
      const part = this.keyPart(at);
      if (part === undefined) {
        return undefined;
      }
      parts.push(part);
      const next = this.skipBlanks(part.end);
      if (this.text[next] !== ".") {
        return { parts, end: part.end };
      }
      at = this.skipBlanks(next + 1);
    }
  }

  private keyPart(start: number): KeyPart | undefined {
    const text = this.text;
    const char = text[start];
    if (char === '"' || char === "'") {
      const end = this.stringEnd(start);
      if (text[end - 1] !== char || end - start < 2) {
        return undefined;
      }
      const body = text.slice(start + 1, end - 1);
      return { name: char === '"' ? unescapeBasic(body) : body, start, end };
    }
    let end = start;
    while (end < text.length && isBareKeyChar(text, end)) {
      end++;
    }
    return end > start ? { name: text.slice(start, end), start, end } : undefined;
  }

  /** The offset after a string at `start`: basic, literal or their multi-line forms. An unclosed one-line string ends at its line end. */
  private stringEnd(start: number): number {
    const text = this.text;
    const quote = text[start]!;
    const triple = quote.repeat(3);
    if (text.startsWith(triple, start)) {
      let close = text.indexOf(triple, start + 3);
      while (close !== -1 && quote === '"' && isEscaped(text, close)) {
        close = text.indexOf(triple, close + 1);
      }
      if (close === -1) {
        return text.length;
      }
      // A closing run may hold up to two more quotes, which belong to the string.
      let end = close + 3;
      while (text[end] === quote && end < close + 5) {
        end++;
      }
      this.pos = Math.max(this.pos, this.lineStartOf(end));
      return end;
    }
    let at = start + 1;
    while (at < text.length && text[at] !== "\n") {
      const char = text[at];
      if (quote === '"' && char === "\\") {
        at += 2;
        continue;
      }
      if (char === quote) {
        return at + 1;
      }
      at++;
    }
    return at;
  }

  private skipBlanks(start: number): number {
    let at = start;
    while (this.text[at] === " " || this.text[at] === "\t") {
      at++;
    }
    return at;
  }

  /** Skips blanks, line breaks and comments, as arrays and inline tables allow between their entries. */
  private skipBlanksAndComments(start: number): number {
    let at = start;
    for (;;) {
      const char = this.text[at];
      if (char === " " || char === "\t" || char === "\n" || char === "\r") {
        at++;
      } else if (char === "#") {
        const end = this.text.indexOf("\n", at);
        at = end === -1 ? this.text.length : end;
      } else {
        return at;
      }
    }
  }

  private nextLineStart(at: number): number {
    const end = this.text.indexOf("\n", at);
    return end === -1 ? this.text.length : end + 1;
  }

  private lineStartOf(at: number): number {
    return this.text.lastIndexOf("\n", at - 1) + 1;
  }
}

function isBareKeyChar(text: string, at: number): boolean {
  const code = text.charCodeAt(at);
  if (code < 0x80) {
    return (code >= 0x61 && code <= 0x7a) || (code >= 0x41 && code <= 0x5a) || (code >= 0x30 && code <= 0x39) || code === 0x5f || code === 0x2d;
  }
  return BARE_KEY_CHAR.test(text[at]!);
}

function isEscaped(text: string, at: number): boolean {
  let backslashes = 0;
  while (text[at - 1 - backslashes] === "\\") {
    backslashes++;
  }
  return backslashes % 2 === 1;
}

function unescapeBasic(body: string): string {
  return body.replace(/\\(u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|x[0-9a-fA-F]{2}|.)/g, (_, escape: string) => {
    if (escape.length > 1) {
      return String.fromCodePoint(parseInt(escape.slice(1), 16));
    }
    return BASIC_ESCAPES[escape] ?? escape;
  });
}

const BASIC_ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", e: "\u001b" };
