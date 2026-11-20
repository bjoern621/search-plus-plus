import { textEngine } from "../../engines/text"
import { structuralEngines } from "../../structural"
import type { SearchEngine } from "../types"

/** The engines that a worker runs. Each returns its matches without a promise and imports nothing of `vscode`. */
export function workerEngines(): SearchEngine[] {
    return [textEngine, ...structuralEngines()]
}
