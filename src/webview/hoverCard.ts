import type { FileResult, HoverGeometry, ResultLine } from "../messages";
import { describeLine, highlightParts, relativePath } from "./tree";

/** Time that the pointer rests on a match before the hover card asks for its excerpt. */
const HOVER_DELAY_DURATION_MS = 500;

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
 * The hovered line of the card covers its row exactly, so the code keeps its place while the lines around it appear.
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

  /**
   * Shows the excerpt that answers request `requestId`. An answer to an older request changes nothing.
   * Near an edge of the view, the card drops the lines on that side before it moves, since a move would shift the hovered line off its row.
   */
  show(requestId: number, excerpt: readonly ResultLine[]): void {
    if (requestId !== this.requestId || !this.target || excerpt.length === 0) return;
    const { file, line } = this.target;
    const row = this.findRow(file, line);
    const lines = mergeExcerpt(excerpt, file);
    const hit = lines.findIndex((excerptLine) => excerptLine.line === line);
    if (!row || hit === -1) return;
    const header = document.createElement("div");
    header.className = "hover-file";
    header.textContent = [file.root, relativePath(file)].filter((part) => part !== "").join("/");
    const elements = lines.map((excerptLine) => lineElement(excerptLine, excerptLine.line === line));
    this.element.replaceChildren(header, ...elements);
    // The numbers take the width of the numbers in the results, so the text of the hovered line starts where its row's text starts.
    const rowNumberWidth = getComputedStyle(row).getPropertyValue("--line-number-width").trim() || "2ch";
    this.element.style.setProperty("--line-number-width", `max(${rowNumberWidth}, ${String((lines.at(-1)?.line ?? 0) + 1).length}ch)`);
    this.element.style.top = "0px";
    this.element.hidden = false;

    const rowBox = row.getBoundingClientRect();
    const hitElement = elements[hit] as HTMLElement;
    const lineHeight = hitElement.offsetHeight;
    let aboveHit = hitElement.getBoundingClientRect().top - this.element.getBoundingClientRect().top;
    const dropBefore = Math.min(hit, Math.max(0, Math.ceil((aboveHit - rowBox.top) / lineHeight)));
    aboveHit -= dropBefore * lineHeight;
    let top = Math.max(0, rowBox.top - aboveHit);
    let height = this.element.offsetHeight - dropBefore * lineHeight;
    const after = lines.length - hit - 1;
    const dropAfter = Math.min(after, Math.max(0, Math.ceil((top + height - window.innerHeight) / lineHeight)));
    height -= dropAfter * lineHeight;
    if (top + height > window.innerHeight) top = Math.max(0, window.innerHeight - height);

    for (const element of [...elements.slice(0, dropBefore), ...elements.slice(elements.length - dropAfter)]) element.remove();
    this.lines = lines.slice(dropBefore, lines.length - dropAfter);
    this.element.style.top = `${top}px`;
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

  /** Measures where the hovered line of the card sits against its row. For integration tests. */
  geometry(): HoverGeometry | undefined {
    const row = this.target && this.findRow(this.target.file, this.target.line);
    const line = this.element.querySelector(".hover-line.hovered");
    if (this.element.hidden || !row || !line) return undefined;
    const card = this.element.getBoundingClientRect();
    const textLeft = (element: Element) => element.querySelector(".text")?.getBoundingClientRect().left ?? Number.NaN;
    return {
      rowTop: row.getBoundingClientRect().top,
      lineTop: line.getBoundingClientRect().top,
      rowTextLeft: textLeft(row),
      lineTextLeft: textLeft(line),
      cardTop: card.top,
      cardBottom: card.bottom,
      viewHeight: window.innerHeight,
    };
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
