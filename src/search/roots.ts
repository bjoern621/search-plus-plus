import * as vscode from "vscode"
import type { SearchRoot } from "./workspaceEngine"
import { turnedOnGlobs } from "./globs"
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
 * It leaves out the `.git` folders, the globs that `files.exclude` turns on and the globs of `searchPlusPlus.exclude`.
 * It leaves out what the ignore files hide while `searchPlusPlus.searchIgnoredFiles` stays off.
 * `search.useParentIgnoreFiles` and `search.useGlobalIgnoreFiles` add the ignore files above the folder and the global one, as in the built-in Search view.
 * Every search covers the files that `search.exclude` hides.
 */
function walkSettings(folder: vscode.WorkspaceFolder): WalkSettings {
    const search = vscode.workspace.getConfiguration("search", folder.uri)
    const files = vscode.workspace.getConfiguration("files", folder.uri)
    const own = vscode.workspace.getConfiguration("searchPlusPlus", folder.uri)
    return {
        excludeGlobs: [
            "**/.git",
            ...turnedOnGlobs(files.get<Record<string, unknown>>("exclude", {})),
            ...own.get<string[]>("exclude", [])
        ],
        useIgnoreFiles: !own.get<boolean>("searchIgnoredFiles", false),
        useParentIgnoreFiles: search.get<boolean>("useParentIgnoreFiles", false),
        useGlobalIgnoreFiles: search.get<boolean>("useGlobalIgnoreFiles", false),
        followSymlinks: search.get<boolean>("followSymlinks", true)
    }
}
