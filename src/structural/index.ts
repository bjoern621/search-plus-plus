import type { SearchEngine } from "../search/types";
import { jsonEngine } from "./jsonEngine";
import { tomlEngine } from "./tomlEngine";
import { yamlEngine } from "./yamlEngine";

export { compareKeyDefault } from "./compareKeyDefault";
export { jsonEngine } from "./jsonEngine";
export { tomlEngine } from "./tomlEngine";
export { yamlEngine } from "./yamlEngine";

/** The key path engines for YAML, JSON and TOML. None of them imports `vscode`. */
export function structuralEngines(): SearchEngine[] {
  return [yamlEngine, jsonEngine, tomlEngine];
}
