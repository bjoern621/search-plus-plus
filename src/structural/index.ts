import type { SearchEngine } from "../search/types"
import { codeEngine } from "./codeEngine"
import { jsonEngine } from "./jsonEngine"
import { tomlEngine } from "./tomlEngine"
import { yamlEngine } from "./yamlEngine"

export { codeEngine } from "./codeEngine"
export { compareKeyDefault } from "./compareKeyDefault"
export { jsonEngine } from "./jsonEngine"
export { tomlEngine } from "./tomlEngine"
export { yamlEngine } from "./yamlEngine"

/** The key path engines for YAML, JSON, TOML and the member access chains of code. None of them imports `vscode`. */
export function structuralEngines(): SearchEngine[] {
    return [yamlEngine, jsonEngine, tomlEngine, codeEngine]
}
