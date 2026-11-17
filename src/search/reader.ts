import { readFile, stat } from "node:fs/promises"
import * as vscode from "vscode"
import { BINARY_SNIFF_LENGTH_BYTES, FILE_SIZE_LIMIT_BYTES } from "./config"

const decoder = new TextDecoder("utf-8")

/**
 * Reads the text that a search sees in a file: the editor's text when the file has unsaved changes, else the file.
 * `unsaved` maps a URI string to the text of its dirty editor.
 * Returns undefined for a binary file, a file over `FILE_SIZE_LIMIT_BYTES` and a file that cannot be read.
 */
export async function readSearchText(
    uri: vscode.Uri,
    unsaved: ReadonlyMap<string, string>
): Promise<string | undefined> {
    const dirty = unsaved.get(uri.toString())
    if (dirty !== undefined) return dirty
    const bytes = await readBytes(uri).catch(() => undefined)
    if (!bytes || isBinary(bytes)) return undefined
    return decoder.decode(bytes)
}

/** Snapshots the text of every editor with unsaved changes. */
export function unsavedTexts(): Map<string, string> {
    return new Map(
        vscode.workspace.textDocuments
            .filter((document) => document.isDirty)
            .map((document) => [document.uri.toString(), document.getText()])
    )
}

async function readBytes(uri: vscode.Uri): Promise<Uint8Array | undefined> {
    if (uri.scheme === "file") {
        if ((await stat(uri.fsPath)).size > FILE_SIZE_LIMIT_BYTES) return undefined
        return readFile(uri.fsPath)
    }
    if ((await vscode.workspace.fs.stat(uri)).size > FILE_SIZE_LIMIT_BYTES) return undefined
    return vscode.workspace.fs.readFile(uri)
}

function isBinary(bytes: Uint8Array): boolean {
    return bytes.subarray(0, BINARY_SNIFF_LENGTH_BYTES).includes(0)
}
