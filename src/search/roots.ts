import * as vscode from "vscode";
import type { SearchRoot } from "./workspaceEngine";
import { enabledGlobs, type ExcludeSetting, type WalkSettings } from "./walk";

/** Describes each workspace folder with the settings that pick its files. */
export function searchRoots(): SearchRoot[] {
  const folders = vscode.workspace.workspaceFolders ?? [];
  return folders.map((folder) => ({
    index: folder.index,
    name: folders.length > 1 ? folder.name : "",
    uri: folder.uri.toString(),
    fsPath: folder.uri.scheme === "file" ? folder.uri.fsPath : undefined,
    walk: walkSettings(folder),
  }));
}

function walkSettings(folder: vscode.WorkspaceFolder): WalkSettings {
  const files = vscode.workspace.getConfiguration("files", folder.uri);
  const search = vscode.workspace.getConfiguration("search", folder.uri);
  return {
    excludeGlobs: enabledGlobs(files.get<ExcludeSetting>("exclude"), search.get<ExcludeSetting>("exclude")),
    useIgnoreFiles: search.get<boolean>("useIgnoreFiles", true),
    useParentIgnoreFiles: search.get<boolean>("useParentIgnoreFiles", false),
    useGlobalIgnoreFiles: search.get<boolean>("useGlobalIgnoreFiles", false),
    followSymlinks: search.get<boolean>("followSymlinks", true),
  };
}
