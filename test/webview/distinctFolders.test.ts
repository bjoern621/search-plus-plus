import { describe, expect, it } from "vitest"
import { distinctFolderIndices } from "../../src/webview/distinctFolders"
import { folderCuts as cutsOf } from "../../src/webview/fitPaths"

const folderCuts = (folders: string, kept?: readonly number[]) =>
    cutsOf(folders, kept).map((cut) => cut.text)

const split = (...paths: string[]) => paths.map((path) => (path === "" ? [] : path.split("/")))

describe("distinctFolderIndices", () => {
    it("picks the worktree folder that tells a file apart from its copies in other checkouts", () => {
        const paths = split(
            "argocd/applications/gitlab-runner",
            ".claude/worktrees/atticd-speed/argocd/applications/gitlab-runner",
            ".claude/worktrees/flake-bump/argocd/applications/gitlab-runner"
        )
        expect(distinctFolderIndices(paths)).toEqual([[], [2], [2]])
    })

    it("picks the same column in paths of the same depth", () => {
        expect(distinctFolderIndices(split("apps/web/src", "apps/api/src"))).toEqual([[1], [1]])
    })

    it("lines up paths of different depths at the folder holding the file", () => {
        expect(distinctFolderIndices(split("packages/core/lib", "lib"))).toEqual([[1], []])
    })

    it("picks the column nearer the file name when two columns split equally", () => {
        expect(distinctFolderIndices(split("x/p", "y/q"))).toEqual([[1], [1]])
    })

    it("picks a second column when one leaves paths together", () => {
        expect(distinctFolderIndices(split("a/x", "a/y", "b/x"))).toEqual([
            [0, 1],
            [0, 1],
            [0, 1]
        ])
    })

    it("picks no folder for a single path or for paths that no folder tells apart", () => {
        expect(distinctFolderIndices([])).toEqual([])
        expect(distinctFolderIndices(split("a/b"))).toEqual([[]])
        expect(distinctFolderIndices(split("a/b", "a/b"))).toEqual([[], []])
    })

    it("picks the folder of a file that sits beside the workspace root", () => {
        expect(distinctFolderIndices(split("", "docs"))).toEqual([[], [0]])
    })
})

describe("folderCuts", () => {
    it("drops folders from the front without kept folders", () => {
        expect(folderCuts("a/b/c")).toEqual(["a/b/c/", "…/b/c/", "…/c/", "…/"])
    })

    it("drops kept folders last and shows each run of dropped folders as one ellipsis", () => {
        expect(folderCuts("a/x/b/c", [1])).toEqual([
            "a/x/b/c/",
            "…/x/b/c/",
            "…/x/…/c/",
            "…/x/…/",
            "…/"
        ])
    })

    it("keeps the marks of the folders that a cut shows", () => {
        const cuts = cutsOf("deploy/web-staging/config", [], [{ start: 11, end: 18 }])
        expect(cuts.map((cut) => [cut.text, cut.ranges])).toEqual([
            ["deploy/web-staging/config/", [{ start: 11, end: 18 }]],
            ["…/web-staging/config/", [{ start: 6, end: 13 }]],
            ["…/config/", []],
            ["…/", []]
        ])
    })
})
