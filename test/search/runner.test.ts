import { writeFile } from "node:fs/promises"
import * as path from "node:path"
import { describe, expect, it } from "vitest"
import { RESULT_LINE_LIMIT } from "../../src/search/config"
import { Uri, workspace } from "../vscodeStub"
import { folderWith, matchedLines, rootAt, runSearch } from "./runnerSetup"

/**
 * Stands in for ripgrep in a regex search: matches each line of the files f0.txt, f1.txt and on, without end.
 * It quits after a while, so a failing test leaves no process behind.
 */
const ENDLESS_RIPGREP = `#!/usr/bin/env node
if (!process.argv.includes("--json")) process.exit(1);
const quitAt = Date.now() + 30000;
const match = (path, line) => JSON.stringify({ type: "match", data: { path: { text: path }, lines: { text: "needle\\n" }, line_number: line + 1, submatches: [{ match: { text: "needle" }, start: 0, end: 6 }] } });
(async () => {
  for (let file = 0; Date.now() < quitAt; file++) {
    const path = "./f" + file + ".txt";
    const lines = Array.from({ length: 1000 }, (_, line) => match(path, line));
    lines.push(JSON.stringify({ type: "end", data: { path: { text: path } } }));
    if (!process.stdout.write(lines.join("\\n") + "\\n")) await new Promise((resolve) => process.stdout.once("drain", resolve));
  }
})();
`

describe("SearchRunner", () => {
    it("searches the other folders when ripgrep cannot start in a deleted folder", async () => {
        const dir = await folderWith({ "a.txt": "needle\n" })
        const roots = [rootAt(0, path.join(dir, "deleted")), rootAt(1, dir)]
        for (const query of ["needle", "/needle/"]) {
            const result = await runSearch(query, roots)
            expect(result.outcome).toEqual({ status: "complete" })
            expect(matchedLines(result.files)).toEqual(["a.txt:1: needle"])
            expect(result.log.join("\n")).toContain("ENOENT")
        }
    })

    it("stops ripgrep once the matched lines reach the limit", { timeout: 10_000 }, async () => {
        const dir = await folderWith(
            Object.fromEntries(
                Array.from({ length: 20 }, (_, file) => [`f${file}.txt`, "needle\n".repeat(1000)])
            )
        )
        const rgPath = path.join(dir, "..", `${path.basename(dir)}-rg.mjs`)
        await writeFile(rgPath, ENDLESS_RIPGREP, { mode: 0o755 })
        const result = await runSearch("/needle/", [rootAt(0, dir)], { rgPath })
        expect(result.outcome).toEqual({ status: "capped", limit: RESULT_LINE_LIMIT })
        expect(result.files.reduce((sum, file) => sum + file.matchCount, 0)).toBe(RESULT_LINE_LIMIT)
    })

    it("searches the editor text of a file with unsaved changes in place of the file", async () => {
        const dir = await folderWith({
            "a.txt": "needle\n",
            "b.txt": "nothing\n",
            "c.txt": "needle\n"
        })
        const edited = { "a.txt": "other\nneedle\n", "b.txt": "needle\n", "c.txt": "gone\n" }
        workspace.textDocuments = Object.entries(edited).map(([name, text]) => ({
            uri: Uri.file(path.join(dir, name)),
            isDirty: true,
            getText: () => text
        }))
        try {
            for (const query of ["needle", "/needle/"]) {
                const result = await runSearch(query, [rootAt(0, dir)])
                expect(matchedLines(result.files)).toEqual(["a.txt:2: needle", "b.txt:1: needle"])
            }
        } finally {
            workspace.textDocuments = []
        }
    })

    it("counts a lone carriage return as a line break, as the editor does", async () => {
        const dir = await folderWith({ "a.txt": "one\rneedle\r\nthree\n" })
        for (const query of ["needle", "/needle/"]) {
            const result = await runSearch(query, [rootAt(0, dir)])
            expect(matchedLines(result.files)).toEqual(["a.txt:2: needle"])
        }
    })
})
