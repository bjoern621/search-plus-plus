import type { SearchEngine } from "../search/types";
import { jsonEngine } from "./jsonEngine";
import { yamlEngine } from "./yamlEngine";

export { compareKeyDefault } from "./compareKeyDefault";
export { jsonEngine } from "./jsonEngine";
export { yamlEngine } from "./yamlEngine";

/** The key path engines for YAML and JSON. None of them imports `vscode`. */
export function structuralEngines(): SearchEngine[] {
  return [yamlEngine, jsonEngine];
}
