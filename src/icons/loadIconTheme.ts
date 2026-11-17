import { type ParseError, parse, printParseErrorCode } from "jsonc-parser"
import * as vscode from "vscode"
import type { ColorKind, IconThemeDocument } from "./iconTheme"

export interface LoadedIconTheme {
    id: string
    document: IconThemeDocument
    /** The folder of the theme document, which its paths start from. */
    folder: vscode.Uri
    /** The folder of the extension that contributes the theme. */
    extensionFolder: vscode.Uri
}

interface IconThemeContribution {
    id: string
    path: string
}

/** The file icon theme that VS Code shows. Undefined for "None". */
export function activeIconThemeId(): string | undefined {
    const id = vscode.workspace.getConfiguration("workbench").get<string | null>("iconTheme")
    return typeof id === "string" && id !== "" ? id : undefined
}

/** Folders of the installed extensions that contribute a file icon theme, built-in ones included. */
export function iconThemeExtensionFolders(): vscode.Uri[] {
    return vscode.extensions.all
        .filter((extension) => iconThemeContributions(extension).length > 0)
        .map((extension) => extension.extensionUri)
}

/**
 * Reads the document of the theme `id` from the extension that contributes it.
 * Errors if no installed extension contributes `id` or the document fails to parse.
 */
export async function loadIconTheme(id: string): Promise<LoadedIconTheme> {
    for (const extension of vscode.extensions.all) {
        const contribution = iconThemeContributions(extension).find(
            (candidate) => candidate.id === id
        )
        if (!contribution) continue
        const location = vscode.Uri.joinPath(extension.extensionUri, contribution.path)
        const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(location))
        const errors: ParseError[] = []
        const document: unknown = parse(text, errors, { allowTrailingComma: true })
        if (errors.length > 0)
            throw new Error(
                `${location.toString()} holds invalid JSON: ${errors.map((error) => `${printParseErrorCode(error.error)} at offset ${error.offset}`).join(", ")}`
            )
        if (typeof document !== "object" || document === null || Array.isArray(document))
            throw new Error(`${location.toString()} holds no JSON object`)
        return {
            id,
            document,
            folder: vscode.Uri.joinPath(location, ".."),
            extensionFolder: extension.extensionUri
        }
    }
    throw new Error(`no installed extension contributes the file icon theme ${id}`)
}

export function colorKind(kind: vscode.ColorThemeKind): ColorKind {
    switch (kind) {
        case vscode.ColorThemeKind.Light:
            return "light"
        case vscode.ColorThemeKind.HighContrast:
            return "highContrast"
        case vscode.ColorThemeKind.HighContrastLight:
            return "highContrastLight"
        default:
            return "dark"
    }
}

function iconThemeContributions(extension: vscode.Extension<unknown>): IconThemeContribution[] {
    const themes = (extension.packageJSON as { contributes?: { iconThemes?: unknown } } | undefined)
        ?.contributes?.iconThemes
    if (!Array.isArray(themes)) return []
    return themes.filter(
        (theme): theme is IconThemeContribution =>
            typeof theme?.id === "string" && typeof theme?.path === "string"
    )
}
