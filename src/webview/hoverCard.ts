import type { FileResult, ResultLine } from "../messages";
import { describeLine, highlightParts, relativePath } from "./tree";

/** Time that the pointer rests on a match before the hover card asks for its excerpt. */
const HOVER_DELAY_DURATION_MS = 500;
/** Space between the card and the edges of the view, as in the mockup. */
const CARD_LEFT_PX = 12;
const CARD_RIGHT_PX = 8;

/** Puts the lines that the results hold into an excerpt, so its matches keep their marks. */
export function mergeExcerpt(excerpt: readonly ResultLine[], file: FileResult): ResultLine[] {
  const known = new Map(file.blocks.flat().map((line) => [line.line, line]));
  return excerpt.map((line) => {
    const result = known.get(line.line);
    return result?.match ? result : line;
  });
}

interface Target {
  file: FileResult;
  line: number;
}

/**
 * Shows a larger excerpt of the file around a match once the pointer rests on it.
 * The card names the file, then the lines around the match, the hovered line marked.
 */
export class HoverCard {
  private target: Target | undefined;
  private timer = 0;
  private requestId = 0;
  private lines: ResultLine[] = [];

  constructor(
    private readonly element: HTMLDivElement,
    private readonly requestExcerpt: (requestId: number, uri: string, line: number) => void,
    /** Finds the rendered row of the match, since a render replaces the row elements. */
    private readonly findRow: (file: FileResult, line: number) => HTMLElement | undefined,
  ) {}

  /** Starts the delay for the match on `line` of `file`, unless the card shows or waits for that match already. */
  schedule(file: FileResult, line: number): void {
    if (this.target?.file.uri === file.uri && this.target.line === line) return;
    this.hide();
    this.target = { file, line };
    this.timer = window.setTimeout(() => this.requestExcerpt(++this.requestId, file.uri, line), HOVER_DELAY_DURATION_MS);
  }

  /** Shows the excerpt that answers request `requestId`. An answer to an older request changes nothing. */
  show(requestId: number, excerpt: readonly ResultLine[]): void {
    if (requestId !== this.requestId || !this.target || excerpt.length === 0) return;
    const { file, line } = this.target;
    const anchor = this.findRow(file, line);
    if (!anchor) return;
    this.lines = mergeExcerpt(excerpt, file);
    const header = document.createElement("div");
    header.className = "hover-file";
    header.textContent = [file.root, relativePath(file)].filter((part) => part !== "").join("/");
    this.element.replaceChildren(header, ...this.lines.map((excerptLine) => lineElement(excerptLine, excerptLine.line === line)));
    this.element.style.setProperty("--line-number-width", `${Math.max(2, String((this.lines.at(-1)?.line ?? 0) + 1).length)}ch`);
    this.element.hidden = false;
    this.element.style.left = `${CARD_LEFT_PX}px`;
    this.element.style.right = `${CARD_RIGHT_PX}px`;
    const box = anchor.getBoundingClientRect();
    const height = this.element.offsetHeight;
    const below = box.bottom + height <= window.innerHeight;
    this.element.style.top = `${below ? box.bottom : Math.max(0, box.top - height)}px`;
  }

  /** Hides the card and drops a pending request. */
  hide(): void {
    window.clearTimeout(this.timer);
    this.requestId++;
    this.target = undefined;
    this.lines = [];
    this.element.hidden = true;
  }

  /** Lists the file and each line of the card as the rows describe them. For integration tests. */
  describe(): string[] {
    if (this.element.hidden) return [];
    return [this.element.querySelector(".hover-file")?.textContent ?? "", ...this.lines.map(describeLine)];
  }
}

function lineElement(line: ResultLine, hovered: boolean): HTMLElement {
  const element = document.createElement("div");
  element.className = ["hover-line", line.match ? "match" : "", hovered ? "hovered" : ""].filter((name) => name !== "").join(" ");
  const number = document.createElement("span");
  number.className = "number";
  number.textContent = String(line.line + 1);
  const text = document.createElement("span");
  text.className = "text";
  if (line.offset > 0) text.append("…");
  for (const part of highlightParts(line)) {
    if (!part.marked) {
      text.append(part.text);
      continue;
    }
    const mark = document.createElement("mark");
    mark.className = "mark";
    mark.textContent = part.text;
    text.append(mark);
  }
  element.append(number, text);
  return element;
}
