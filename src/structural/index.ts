import type { SearchEngine } from "../search/types";
import { yamlEngine } from "./yamlEngine";

export { compareKeyDefault } from "./compareKeyDefault";
export { yamlEngine } from "./yamlEngine";

/** The key path engine for YAML. It never imports `vscode`. */
export function structuralEngines(): SearchEngine[] {
  return [yamlEngine];
}
