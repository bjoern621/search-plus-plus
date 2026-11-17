import type { ResultLine } from "../messages";

/** The key path that the row of `line` shows after its text, written as a query that finds it. Undefined for a line without one. */
export function shownKeyPath(line: ResultLine): string | undefined {
  return line.showKeyPath && line.keyPath ? keyPathText(line.keyPath) : undefined;
}

/** Writes a key path as a query that finds it: keys joined with dots, a key holding a dot, an operator or a space in quotes. */
export function keyPathText(keys: readonly string[]): string {
  return keys.map((key) => (/[.\\"*?[\]{},\s]/.test(key) ? `"${key.replace(/["\\]/g, (char) => `\\${char}`)}"` : key)).join(".");
}

/** The key path after the line text, cut from the left once the line runs out of room, so the last keys stay in view. */
export function keyPathElement(keyPath: string): HTMLElement {
  const element = document.createElement("span");
  element.className = "key-path";
  const isolated = document.createElement("bdi");
  isolated.textContent = keyPath;
  element.append(isolated);
  return element;
}
