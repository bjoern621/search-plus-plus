import * as vscode from "vscode"
import type { SearchRoot } from "./workspaceEngine"
import type { WalkSettings } from "./walk"

/** Describes each workspace folder with the settings that pick its files. */
export function searchRoots(): SearchRoot[] {
    const folders = vscode.workspace.workspaceFolders ?? []
    return folders.map((folder) => ({
        index: folder.index,
        name: folders.length > 1 ? folder.name : "",
        uri: folder.uri.toString(),
        fsPath: folder.uri.scheme === "file" ? folder.uri.fsPath : undefined,
        walk: walkSettings(folder)
    }))
}

/**
 * Picks the files of one workspace folder.
 * Every search covers the files that the ignore files and the exclude settings hide, minus the `.git` folders.
 */
function walkSettings(folder: vscode.WorkspaceFolder): WalkSettings {
    const search = vscode.workspace.getConfiguration("search", folder.uri)
    return {
        excludeGlobs: ["**/.git"],
        useIgnoreFiles: false,
        useParentIgnoreFiles: false,
        useGlobalIgnoreFiles: false,
        followSymlinks: search.get<boolean>("followSymlinks", true)
    }
}
