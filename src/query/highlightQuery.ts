import { isRegexQuery } from "./parseQuery";
import type { HighlightSpan } from "./types";

type Kind = HighlightSpan["kind"];

const REGEX_METACHARACTERS = new Set([".", "+", "*", "?", "(", ")", "[", "]", "{", "}", "|", "^", "$"]);
const ASCII_LETTER = /^[A-Za-z]$/;

/**
 * Colors each character of the query input by its role.
 * The spans cover every character in order. Neighbouring characters of one kind share a span.
 */
export function highlightQuery(raw: string): HighlightSpan[] {
  const spans = new SpanBuilder();
  if (isRegexQuery(raw)) {
    highlightRegex(raw, spans);
  } else {
    highlightText(raw, spans);
  }
  return spans.spans;
}

function highlightRegex(raw: string, spans: SpanBuilder): void {
  const chars = Array.from(raw);
  spans.add("operator", "/");
  for (let i = 1; i < chars.length - 1; i++) {
    const char = chars[i]!;
    if (char === "\\") {
      const escaped = chars[i + 1]!;
      if (ASCII_LETTER.test(escaped)) {
        spans.add("operator", char + escaped);
      } else {
        spans.add("escape", char);
        spans.add("text", escaped);
      }
      i++;
      continue;
    }
    spans.add(REGEX_METACHARACTERS.has(char) ? "operator" : "text", char);
  }
  spans.add("operator", "/");
}

/** Follows the lexical states of the key path grammar: quotes, classes and groups. Breaks of the grammar keep their characters' roles. */
function highlightText(raw: string, spans: SpanBuilder): void {
  const chars = Array.from(raw);
  let quoted = false;
  let inGroup = false;
  let inClass = false;
  let classOpenedAt = -1;
  let classPlace: ClassPlace = "betweenItems";
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i]!;
    const next = chars[i + 1];
    if (char === "\\") {
      if (next === undefined) {
        spans.add("text", char);
        continue;
      }
      spans.add("escape", char);
      spans.add("text", next);
      i++;
      if (inClass) {
        classPlace = afterClassAtom(classPlace);
      }
      continue;
    }
    if (quoted) {
      quoted = char !== '"';
      spans.add(quoted ? "text" : "operator", char);
      continue;
    }
    if (inClass) {
      if (char === "]") {
        inClass = false;
        spans.add("operator", char);
      } else if (i === classOpenedAt + 1 && (char === "!" || char === "^") && next !== undefined && next !== "]") {
        spans.add("operator", char);
      } else if (char === "-" && classPlace === "afterAtom" && next !== undefined && next !== "]") {
        classPlace = "inRange";
        spans.add("operator", char);
      } else {
        classPlace = afterClassAtom(classPlace);
        spans.add("text", char);
      }
      continue;
    }
    switch (char) {
      case '"':
        quoted = true;
        spans.add("operator", char);
        break;
      case "[":
        inClass = true;
        classOpenedAt = i;
        classPlace = "betweenItems";
        spans.add("operator", char);
        break;
      case "{":
        inGroup = true;
        spans.add("operator", char);
        break;
      case "}":
        inGroup = false;
        spans.add("operator", char);
        break;
      case ",":
        spans.add(inGroup ? "operator" : "text", char);
        break;
      case "*":
      case "?":
      case "]":
        spans.add("operator", char);
        break;
      default:
        spans.add("text", char);
    }
  }
}

class SpanBuilder {
  readonly spans: HighlightSpan[] = [];
  private offset = 0;

  add(kind: Kind, text: string): void {
    const end = this.offset + text.length;
    const last = this.spans[this.spans.length - 1];
    if (last?.kind === kind) {
      last.range.end = end;
    } else {
      this.spans.push({ kind, range: { start: this.offset, end } });
    }
    this.offset = end;
  }
}

/** A `-` right after an atom opens a range. The next atom closes it. */
type ClassPlace = "betweenItems" | "afterAtom" | "inRange";

function afterClassAtom(place: ClassPlace): ClassPlace {
  return place === "inRange" ? "betweenItems" : "afterAtom";
}
