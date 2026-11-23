import { describe, expect, it } from "vitest"
import type { FileResult, FolderResult } from "../../src/messages"
import type { Range } from "../../src/search/types"
import { resultSummary, ResultTree, type Row } from "../../src/webview/tree"

const ROOT = "file:///work"

function file(path: string, matchCount: number, pathRanges?: Range[]): FileResult {
    const slash = path.lastIndexOf("/")
    return {
        uri: `${ROOT}/${path}`,
        rootIndex: 0,
        root: "",
        folder: slash < 0 ? "" : path.slice(0, slash),
        name: path.slice(slash + 1),
        languageId: "plaintext",
        matchCount,
        blocks:
            matchCount === 0 ? [] : [[{ line: 0, text: "x", offset: 0, ranges: [], match: true }]],
        ...(pathRanges ? { pathRanges } : {})
    }
}

function folder(path: string, ranges: Range[]): FolderResult {
    return { uri: `${ROOT}/${path}`, rootIndex: 0, root: "", folder: path, ranges }
}

/** Writes each file and folder row as its text, with each matched name in brackets. */
function rowTexts(rows: readonly Row[]): string[] {
    return rows.flatMap((row) => {
        if (row.kind === "folder")
            return [
                `${mark(row.parent ?? "", row.parentRanges)}|${mark(row.label, row.labelRanges)}`
            ]
        if (row.kind === "file")
            return [`${mark(row.folders, row.folderRanges)}|${mark(row.file.name, row.nameRanges)}`]
        return []
    })
}

function mark(text: string, ranges: readonly Range[]): string {
    let marked = text
    for (const range of [...ranges].sort((a, b) => b.start - a.start))
        marked = `${marked.slice(0, range.start)}[${marked.slice(range.start, range.end)}]${marked.slice(range.end)}`
    return marked
}

function treeWith(): ResultTree {
    const tree = new ResultTree()
    tree.add([
        file("deploy/web-staging/config/values.yaml", 2),
        file("docs/staging-guide.md", 1, [{ start: 5, end: 12 }])
    ])
    tree.addFolders([
        folder("deploy/web-staging", [{ start: 11, end: 18 }]),
        folder("docs/empty-staging", [{ start: 11, end: 18 }])
    ])
    return tree
}

describe("ResultTree with matched names", () => {
    it("lists a matched folder alone when no shown file sits below it", () => {
        expect(rowTexts(treeWith().rows(new Set(), "list"))).toEqual([
            "deploy/web-[staging]/config|values.yaml",
            "docs|[staging]-guide.md",
            "docs|empty-[staging]"
        ])
    })

    it("marks a matched folder in the tree once, on the row that shows it", () => {
        expect(rowTexts(treeWith().rows(new Set(), "tree"))).toEqual([
            "deploy/web-[staging]/config|values.yaml",
            "|docs",
            "|empty-[staging]",
            "|[staging]-guide.md"
        ])
    })

    it("marks the part of a match that spans a parent folder on the parent row", () => {
        const tree = new ResultTree()
        tree.addFolders([
            folder("deploy-apps/web-dev", [{ start: 7, end: 15 }]),
            folder("deploy-apps/web-staging", [{ start: 7, end: 15 }])
        ])
        expect(rowTexts(tree.rows(new Set(), "tree"))).toEqual([
            "|deploy-[apps]",
            "|[web]-dev",
            "|[web]-staging"
        ])
    })

    it("counts a matched name as one result", () => {
        const tree = treeWith()
        expect([tree.matchCount, tree.fileCount, tree.folderCount]).toEqual([6, 2, 2])
        expect(resultSummary(6, 2, undefined, 2)).toBe("6 results in 2 files and 2 folders")
        expect(resultSummary(1, 0, undefined, 1)).toBe("1 result in 1 folder")
    })
})
