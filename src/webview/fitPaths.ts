/** Maps a path element to the texts that it may show, the whole path first. */
const cutsOfElement = new WeakMap<Element, readonly string[]>();

/** A path that shows whole until `fitPaths` cuts it. `cuts` lists the texts that it may show, the whole path first. */
export function pathElement(className: string, cuts: readonly string[]): HTMLElement {
  const element = document.createElement("span");
  element.className = className;
  const isolated = document.createElement("bdi");
  isolated.textContent = cuts[0] ?? "";
  element.append(isolated);
  cutsOfElement.set(element, cuts);
  return element;
}

/**
 * Cuts each path in `elements` that overflows its box to the first of its cuts that fits the box.
 * A path whose last cut fails to fit leaves the page.
 * Reads every box before it writes a text, so the page lays out once for all of them.
 */
export function fitPaths(elements: Iterable<HTMLElement>): void {
  const fitted = [...elements].flatMap((element) => {
    const text = element.firstElementChild;
    const cuts = cutsOfElement.get(element);
    if (!text || !cuts || element.scrollWidth <= element.clientWidth) return [];
    const style = getComputedStyle(element);
    // The box takes fractions of a pixel, which clientWidth rounds away.
    const width = element.getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    return [{ element, text, cut: cuts.find((candidate) => textWidth(candidate, style.font) <= width) }];
  });
  for (const { element, text, cut } of fitted) {
    if (cut === undefined) element.remove();
    else text.textContent = cut;
  }
}

/**
 * Lists the ways to write the folders before a file name, such as `charts/apim/`, the whole path first.
 * The cuts drop whole folders from the front: `…/apim/`, then `…/` alone.
 */
export function folderCuts(folders: string): string[] {
  const names = folders.split("/");
  const cuts = [`${folders}/`];
  for (let dropped = 1; dropped < names.length; dropped++) cuts.push(`…/${names.slice(dropped).join("/")}/`);
  cuts.push("…/");
  return cuts;
}

let canvas: CanvasRenderingContext2D | undefined;
/** Maps a font and a text, joined by a line break, to the width of the text in pixels. Grows with each path cut. */
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
