import { describe, expect, it } from "vitest"
import { FILE_SIZE_LIMIT_BYTES } from "../../src/search/config"
import { enabledGlobs, ripgrepWalkArgs, WalkExcludes } from "../../src/search/walk"

const defaults = {
    excludeGlobs: [],
    useIgnoreFiles: true,
    useParentIgnoreFiles: false,
    useGlobalIgnoreFiles: false,
    followSymlinks: true
}

describe("enabledGlobs", () => {
    it("keeps globs set to true and drops false ones and when clauses", () => {
        expect(
            enabledGlobs(
                {
                    "**/.git": true,
                    "**/node_modules": false,
                    "**/*.js": { when: "$(basename).ts" }
                },
                { "**/dist": true, "**/.git": true }
            )
        ).toEqual(["**/.git", "**/dist"])
    })
})

describe("ripgrepWalkArgs", () => {
    it("anchors a relative glob at the folder root and trims trailing slashes", () => {
        const args = ripgrepWalkArgs({
            ...defaults,
            excludeGlobs: ["**/node_modules", "build/", "/out"]
        })
        expect(args).toContain("!**/node_modules")
        expect(args).toContain("!/build")
        expect(args).toContain("!/out")
    })

    it("mirrors the VS Code defaults for ignore files and symlinks", () => {
        expect(ripgrepWalkArgs(defaults)).toEqual([
            "--no-config",
            "--hidden",
            "--no-require-git",
            "--max-filesize",
            String(FILE_SIZE_LIMIT_BYTES),
            "--no-ignore-parent",
            "--no-ignore-global",
            "--follow"
        ])
    })

    it("reads no ignore file when search.useIgnoreFiles is off", () => {
        const args = ripgrepWalkArgs({ ...defaults, useIgnoreFiles: false })
        expect(args).toContain("--no-ignore")
        expect(args).not.toContain("--no-ignore-parent")
    })
})

describe("WalkExcludes", () => {
    it("excludes a matched folder with everything below it, at the depth that the glob allows", () => {
        const excludes = new WalkExcludes(["**/vendor", "build/", "/out", "**/*.lock"])
        expect(excludes.excludes("vendor/values.yaml")).toBe(true)
        expect(excludes.excludes("charts/vendor/a/b.yaml")).toBe(true)
        expect(excludes.excludes("build/values.yaml")).toBe(true)
        expect(excludes.excludes("charts/build/values.yaml")).toBe(false)
        expect(excludes.excludes("out/a.js")).toBe(true)
        expect(excludes.excludes("deps/yarn.lock")).toBe(true)
        expect(excludes.excludes("charts/apim/values.yaml")).toBe(false)
    })
})
