import type { Range } from "../search/types";
import { assert } from "./assert";
import type { AltPiece, AltSegment, ClassItem, KeyPathPattern, KeyPathPiece, KeyPathSegment, QueryError } from "./types";

const SKIPS = "The key path skips this query because";

class KeyPathGrammarError extends Error {
  constructor(
    message: string,
    readonly range: Range,
  ) {
    super(message);
  }
}

/** Parses a key path after the grammar in DESIGN.md. Returns the first place where the grammar breaks as `error`. */
export function parseKeyPath(raw: string): { pattern: KeyPathPattern } | { error: QueryError } {
  try {
    return { pattern: new KeyPathParser(raw).parsePath() };
  } catch (thrown) {
    if (!(thrown instanceof KeyPathGrammarError)) {
      throw thrown;
    }
    return { error: { message: thrown.message, range: thrown.range } };
  }
}

/** Offset of the `{` that opened the group being parsed. */
type GroupStart = number;

class KeyPathParser {
  private pos = 0;

  constructor(private readonly src: string) {}

  parsePath(): KeyPathPattern {
    if (this.src.length === 0) {
      throw new KeyPathGrammarError(`${SKIPS} it is empty.`, { start: 0, end: 0 });
    }
    const segments: KeyPathSegment[] = [this.parseSegment(undefined)];
    while (!this.atEnd()) {
      assert(this.peek() === ".", "a top-level segment ends at a dot or at the end");
      this.pos++;
      segments.push(this.parseSegment(undefined));
    }
    return { segments };
  }

  private parseSegment(group: undefined): KeyPathSegment;
  private parseSegment(group: GroupStart): AltSegment;
  private parseSegment(group: GroupStart | undefined): KeyPathSegment | AltSegment {
    if (this.src.startsWith("**", this.pos) && this.endsSegment(this.pos + 2, group)) {
      this.pos += 2;
      return { kind: "globstar" };
    }
    const pieces: KeyPathPiece[] = [];
    while (!this.endsSegment(this.pos, group)) {
      pieces.push(this.parsePiece(group));
    }
    if (pieces.length === 0) {
      this.throwEmptySegment(group);
    }
    return { kind: "key", pieces: mergeRuns(pieces) };
  }

  private endsSegment(pos: number, group: GroupStart | undefined): boolean {
    if (pos >= this.src.length) {
      return true;
    }
    const char = this.src[pos];
    return char === "." || (group !== undefined && (char === "," || char === "}"));
  }

  private throwEmptySegment(group: GroupStart | undefined): never {
    const here = { start: this.pos, end: this.pos + 1 };
    if (group !== undefined) {
      if (this.atEnd()) {
        throw unclosedBrace(group);
      }
      if (this.peek() === "}" && this.pos === group + 1) {
        throw new KeyPathGrammarError(`${SKIPS} a group ({}) holds nothing. Write its alternatives between the braces, separated by commas.`, here);
      }
      throw new KeyPathGrammarError(`${SKIPS} a group ({}) leaves a key empty. Write a key on both sides of each comma and dot.`, here);
    }
    if (this.pos === 0) {
      throw new KeyPathGrammarError(`${SKIPS} it starts with a dot. Remove the dot.`, here);
    }
    if (this.atEnd()) {
      throw new KeyPathGrammarError(`${SKIPS} it ends with a dot. Add a key after the dot or remove it.`, { start: this.pos - 1, end: this.pos });
    }
    throw new KeyPathGrammarError(`${SKIPS} two dots (..) hold no key between them. Remove one dot.`, here);
  }

  private parsePiece(group: GroupStart | undefined): KeyPathPiece {
    const start = this.pos;
    const char = this.peek();
    switch (char) {
      case "\\":
        return { kind: "literal", value: this.parseEscape() };
      case '"':
        return this.parseQuoted();
      case "*":
        this.pos++;
        return { kind: "star" };
      case "?":
        this.pos++;
        return { kind: "question" };
      case "[":
        return this.parseClass();
      case "{":
        if (group !== undefined) {
          throw new KeyPathGrammarError(`${SKIPS} groups cannot nest. Close the first group with } before the next brace ({).`, { start, end: start + 1 });
        }
        return this.parseGroup();
      case "]":
        throw new KeyPathGrammarError(`${SKIPS} a bracket (]) closes nothing. Write \\] to search for the bracket.`, { start, end: start + 1 });
      case "}":
        assert(group === undefined, "a group ends its segment at }");
        throw new KeyPathGrammarError(`${SKIPS} a brace (}) closes nothing. Write \\} to search for the brace.`, { start, end: start + 1 });
      default:
        return { kind: "literal", value: this.takeChar() };
    }
  }

  /** Reads `\` and the character after it. Returns that character. */
  private parseEscape(): string {
    assert(this.peek() === "\\", "an escape starts with a backslash");
    const start = this.pos;
    this.pos++;
    if (this.atEnd()) {
      throw new KeyPathGrammarError(`${SKIPS} it ends with a backslash (\\). Write \\\\ to search for a backslash.`, { start, end: start + 1 });
    }
    return this.takeChar();
  }

  private parseQuoted(): AltPiece {
    const start = this.pos;
    this.pos++;
    let value = "";
    while (!this.atEnd()) {
      const char = this.peek();
      if (char === '"') {
        this.pos++;
        return { kind: "quoted", value };
      }
      value += char === "\\" ? this.parseEscape() : this.takeChar();
    }
    throw new KeyPathGrammarError(`${SKIPS} a quote (") stays open. Close it with ".`, { start, end: start + 1 });
  }

  private parseClass(): AltPiece {
    const start = this.pos;
    this.pos++;
    let negated = false;
    if ((this.peek() === "!" || this.peek() === "^") && this.src[this.pos + 1] !== undefined && this.src[this.pos + 1] !== "]") {
      negated = true;
      this.pos++;
    }
    const items: ClassItem[] = [];
    while (true) {
      if (this.atEnd()) {
        throw new KeyPathGrammarError(`${SKIPS} a bracket ([) stays open. Close it with ].`, { start, end: start + 1 });
      }
      if (this.peek() === "]") {
        break;
      }
      items.push(this.parseClassItem());
    }
    if (items.length === 0) {
      throw new KeyPathGrammarError(`${SKIPS} a pair of brackets ([]) holds no character. Put characters between them or write \\[ to search for the bracket.`, {
        start,
        end: this.pos + 1,
      });
    }
    this.pos++;
    return { kind: "class", negated, items };
  }

  private parseClassItem(): ClassItem {
    const start = this.pos;
    const from = this.parseClassAtom();
    const afterDash = this.src[this.pos + 1];
    if (this.peek() !== "-" || afterDash === undefined || afterDash === "]") {
      return { from, to: from };
    }
    this.pos++;
    const to = this.parseClassAtom();
    if (from.codePointAt(0)! > to.codePointAt(0)!) {
      throw new KeyPathGrammarError(`${SKIPS} the range ${from}-${to} runs backwards. Write it as ${to}-${from}.`, { start, end: this.pos });
    }
    return { from, to };
  }

  private parseClassAtom(): string {
    const char = this.peek();
    if (char === "\\") {
      return this.parseEscape();
    }
    if (char === ".") {
      throw new KeyPathGrammarError(`${SKIPS} a dot (.) sits inside brackets. Close the brackets before the dot or escape it (\\.).`, {
        start: this.pos,
        end: this.pos + 1,
      });
    }
    return this.takeChar();
  }

  private parseGroup(): KeyPathPiece {
    const start = this.pos;
    this.pos++;
    const alternatives: AltSegment[][] = [];
    while (true) {
      alternatives.push(this.parseAlternative(start));
      if (this.atEnd()) {
        throw unclosedBrace(start);
      }
      const char = this.peek();
      this.pos++;
      if (char === "}") {
        return { kind: "group", alternatives };
      }
      assert(char === ",", "an alternative ends at a comma, a brace or the end");
    }
  }

  private parseAlternative(group: GroupStart): AltSegment[] {
    const segments = [this.parseSegment(group)];
    while (this.peek() === ".") {
      this.pos++;
      segments.push(this.parseSegment(group));
    }
    return segments;
  }

  private atEnd(): boolean {
    return this.pos >= this.src.length;
  }

  /** The code point at the current position, or "" at the end. */
  private peek(): string {
    const codePoint = this.src.codePointAt(this.pos);
    return codePoint === undefined ? "" : String.fromCodePoint(codePoint);
  }

  private takeChar(): string {
    const char = this.peek();
    assert(char !== "", "takeChar needs a character left");
    this.pos += char.length;
    return char;
  }
}

function unclosedBrace(groupStart: GroupStart): KeyPathGrammarError {
  return new KeyPathGrammarError(`${SKIPS} a brace ({) stays open. Close it with }.`, { start: groupStart, end: groupStart + 1 });
}

/** Joins neighbouring literal pieces, and neighbouring quoted pieces, into one piece each. */
function mergeRuns(pieces: KeyPathPiece[]): KeyPathPiece[] {
  const merged: KeyPathPiece[] = [];
  for (const piece of pieces) {
    const last = merged[merged.length - 1];
    if ((last?.kind === "literal" || last?.kind === "quoted") && last.kind === piece.kind) {
      merged[merged.length - 1] = { kind: last.kind, value: last.value + piece.value };
      continue;
    }
    merged.push(piece);
  }
  return merged;
}
