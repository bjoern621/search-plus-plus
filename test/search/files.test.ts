import * as vscode from "vscode"
import { afterEach, describe, expect, it } from "vitest"
import { collectFiles } from "../../src/search/files"
import { rootAt } from "./runnerSetup"

describe("collectFiles", () => {
    const listFiles = vscode.workspace.findFiles
    afterEach(() => {
        vscode.workspace.findFiles = listFiles
    })

    it("hands every exclude glob to findFiles, globs with braces included", async () => {
        const excludes: unknown[] = []
        vscode.workspace.findFiles = async (_include, exclude) => {
            excludes.push(exclude)
            return []
        }
        const root = rootAt(0, "/workspace")
        root.walk.excludeGlobs = ["**/*.{log,tmp}", "**/node_modules"]
        await collectFiles([root], undefined, new AbortController().signal, () => {})
        expect(excludes).toEqual(["{**/*.log,**/*.tmp,**/node_modules}"])
    })

    it("drops the listed paths that a glob with a brace left open excludes", async () => {
        vscode.workspace.findFiles = async () => [
            vscode.Uri.file("/workspace/notes/{draft"),
            vscode.Uri.file("/workspace/notes/final")
        ]
        const root = rootAt(0, "/workspace")
        root.walk.excludeGlobs = ["**/{draft"]
        const files = await collectFiles([root], undefined, new AbortController().signal, () => {})
        expect(files.map((file) => file.relativePath)).toEqual(["notes/final"])
    })
})
