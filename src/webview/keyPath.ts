import type { ResultLine } from "../messages";

/** The keys of the key path that the row of `line` shows after its text. Undefined for a line without one. */
export function shownKeys(line: ResultLine): readonly string[] | undefined {
  return line.showKeyPath && line.keyPath ? line.keyPath : undefined;
}

/** Writes a key path as a query that finds it: keys joined with dots, a key holding a dot, an operator or a space in quotes. */
export function keyPathText(keys: readonly string[]): string {
  return keys.map(keyText).join(".");
}

function keyText(key: string): string {
  return /[.\\"*?[\]{},\s]/.test(key) ? `"${key.replace(/["\\]/g, (char) => `\\${char}`)}"` : key;
}

/**
 * Writes `keys` as a key path no wider than `width`, as `measure` measures a text.
 * A path too wide drops whole keys from its second key on, behind an ellipsis: `gateway.….limits.memory`.
 * The first and the last key stay, until even the first key leaves too little room: `….memory`.
 * Returns undefined once the last key alone fails to fit.
 */
export function cutKeyPath(keys: readonly string[], width: number, measure: (text: string) => number): string | undefined {
  const texts = keys.map(keyText);
  const candidates = [texts.join(".")];
  for (let kept = 2; kept < texts.length; kept++) candidates.push([texts[0], "…", ...texts.slice(kept)].join("."));
  if (texts.length > 1) candidates.push(`….${texts.at(-1)}`);
  return candidates.find((text) => measure(text) <= width);
}

const keysOfElement = new WeakMap<Element, readonly string[]>();

/** The key path after the line text, whole until `fitKeyPaths` cuts it. */
export function keyPathElement(keys: readonly string[], className = "key-path"): HTMLElement {
  const element = document.createElement("span");
  element.className = className;
  const isolated = document.createElement("bdi");
  isolated.textContent = keyPathText(keys);
  element.append(isolated);
  keysOfElement.set(element, keys);
  return element;
}

/**
 * Cuts each key path in `elements` that overflows its box to the width of the box, at key boundaries.
 * A key path whose last key alone fails to fit leaves the page.
 * Reads every box before it writes a text, so the page lays out once for all of them.
 */
export function fitKeyPaths(elements: Iterable<HTMLElement>): void {
  const cuts = [...elements].flatMap((element) => {
    const text = element.firstElementChild;
    const keys = keysOfElement.get(element);
    if (!text || !keys || element.scrollWidth <= element.clientWidth) return [];
    const style = getComputedStyle(element);
    const width = element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    return [{ element, text, cut: cutKeyPath(keys, width, (candidate) => textWidth(candidate, style.font)) }];
  });
  for (const { element, text, cut } of cuts) {
    if (cut === undefined) element.remove();
    else text.textContent = cut;
  }
}

let canvas: CanvasRenderingContext2D | undefined;
/** Maps a font and a text, joined by a line break, to the width of the text in pixels. Grows with each key path cut. */
const measuredWidths = new Map<string, number>();

/** Measures on a canvas, since laying out each candidate in the page would cost a layout per candidate. */
function textWidth(text: string, font: string): number {
  const key = `${font}\n${text}`;
  const known = measuredWidths.get(key);
  if (known !== undefined) return known;
  canvas ??= document.createElement("canvas").getContext("2d") ?? undefined;
  if (!canvas) return Number.POSITIVE_INFINITY;
  canvas.font = font;
  const width = canvas.measureText(text).width;
  measuredWidths.set(key, width);
  return width;
}
