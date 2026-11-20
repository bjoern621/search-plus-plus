import type { KeyPathFiles } from "../api"
import type { FileInfo, LineMatch, Query, SearchEngine, SearchFile } from "../search/types"
import { compareKeyFor } from "./compareKeyDefault"
import { type FileKind, isFileOfKind, keyPathOf } from "./fileKinds"
import { KeyPathCollector, SearchAborted } from "./keyPathCollector"

/**
 * Turns a file type that reads its own keys into a search engine.
 * Throws if `files` breaks a rule that `registerKeyPathFiles` documents.
 * Copies the language IDs and extensions, so a later change to `files` leaves the engine alone.
 */
export function keyPathEngine(files: KeyPathFiles): SearchEngine {
    const kind = fileKindOf(files)
    return {
        id: files.id,

        accepts(file: FileInfo, query: Query): boolean {
            return keyPathOf(query) !== undefined && isFileOfKind(file, kind)
        },

        search(file: SearchFile, query: Query, signal: AbortSignal): LineMatch[] {
            const pattern = keyPathOf(query)
            if (pattern === undefined) {
                return []
            }
            const collector = new KeyPathCollector(file.text, pattern, compareKeyFor(query), signal)
            try {
                files.readKeys(
                    file.text,
                    (path, start, end) => collector.visit(path, start, end),
                    signal
                )
            } catch (error) {
                if (error instanceof SearchAborted) {
                    return []
                }
                throw error
            }
            return collector.results()
        }
    }
}

function fileKindOf(files: KeyPathFiles): FileKind {
    if (files.languageIds.length === 0 && files.extensions.length === 0) {
        throw new Error(
            `The key path file type ${files.id} names no language ID and no extension, so it matches no file. Set \`languageIds\` or \`extensions\`.`
        )
    }
    for (const extension of files.extensions) {
        if (!extension.startsWith(".") || extension.length < 2) {
            throw new Error(
                `The key path file type ${files.id} lists the extension "${extension}". An extension must start with a dot, such as ".ini".`
            )
        }
    }
    return {
        languageIds: new Set(files.languageIds),
        extensions: files.extensions.map((extension) => extension.toLowerCase())
    }
}
