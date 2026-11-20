import type { FileInfo, Query } from "../search/types"
import type { KeyPathPattern } from "../query/types"

/** The language IDs and file extensions that pick an engine. Either one suffices, since VS Code ships no TOML language. */
export interface FileKind {
    languageIds: ReadonlySet<string>
    /** Lower case, with the leading dot. */
    extensions: readonly string[]
}

export const YAML_FILES: FileKind = {
    // The Kubernetes extension marks Helm templates as `helm`.
    languageIds: new Set(["yaml", "helm", "dockercompose"]),
    extensions: [".yaml", ".yml"]
}

export const CODE_FILES: FileKind = {
    languageIds: new Set(["typescript", "javascript", "typescriptreact", "javascriptreact"]),
    extensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]
}

export function isFileOfKind(file: FileInfo, kind: FileKind): boolean {
    if (kind.languageIds.has(file.languageId)) {
        return true
    }
    const path = file.relativePath.toLowerCase()
    return kind.extensions.some((extension) => path.endsWith(extension))
}

/** The key path of a text query, or undefined for a regex query and a query that breaks the key path grammar. */
export function keyPathOf(query: Query): KeyPathPattern | undefined {
    return query.kind === "text" ? query.keyPath : undefined
}
