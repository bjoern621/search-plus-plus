import type { FileResult, HoverGeometry, ResultLine } from "../messages";
import { keyPathElement, shownKeyPath } from "./keyPath";
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
    const elements = lines.map((excerptLine) => lineElement(excerptLine, excerptLine.line === line));
    const header = document.createElement("div");
    header.className = "hover-file";
    const keyPath = shownKeyPath(lines[hit] as ResultLine);
    if (keyPath !== undefined) {
      const separator = document.createElement("span");
      separator.className = "hover-separator";
      separator.textContent = " · ";
      header.append(headerPart("hover-key-path", keyPath), separator);
      elements[hit]?.append(keyPathElement(keyPath));
    }
    const path = [file.root, relativePath(file)].filter((part) => part !== "").join("/");
    const nameStart = path.lastIndexOf("/") + 1;
    const name = document.createElement("span");
    name.className = "hover-file-name";
    name.textContent = path.slice(nameStart);
    header.append(headerPart("hover-folder", path.slice(0, nameStart)), name);
    this.element.replaceChildren(header, ...elements);
    this.element.hidden = false;
    fitHeader(header);
    // The numbers take the width of the numbers in the results, so the text of the hovered line starts where its row's text starts.
    const rowNumberWidth = getComputedStyle(row).getPropertyValue("--line-number-width").trim() || "2ch";
    this.element.style.setProperty("--line-number-width", `max(${rowNumberWidth}, ${String((lines.at(-1)?.line ?? 0) + 1).length}ch)`);
    this.element.style.top = "0px";

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
      headerKeyPathCut: hiddenWidth(this.element.querySelector(".hover-key-path")),
      headerFolderCut: hiddenWidth(this.element.querySelector(".hover-folder")),
    };
  }
}

/**
 * Drops the folder of a header that stays too wide once the folder has shrunk to nothing, so the key path takes the cut.
 * The key path keeps its width before that, since flex items shrink in proportion to their width: a key path shrinking beside the folder would lose a fraction of a pixel, and its ellipsis a character.
 */
function fitHeader(header: HTMLElement): void {
  if (header.scrollWidth > header.clientWidth) header.classList.add("crowded");
}

/** Measures how much of a header part its cut hides. 0 for a missing part. */
function hiddenWidth(part: Element | null): number {
  const text = part?.firstElementChild;
  if (!part || !text) return 0;
  return Math.max(0, text.getBoundingClientRect().width - part.getBoundingClientRect().width);
}

/** A part of the header that gets cut from the left once the header runs out of room, so its end stays in view. */
function headerPart(className: string, text: string): HTMLElement {
  const element = document.createElement("span");
  element.className = className;
  const isolated = document.createElement("bdi");
  isolated.textContent = text;
  element.append(isolated);
  return element;
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
