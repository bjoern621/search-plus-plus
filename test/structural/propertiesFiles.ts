import type { KeyPathFiles } from "../../src/api"

const KEY = /^[ \t]*([^\s#!=:][^\s=:]*)/gm

/**
 * A key path file type for `.properties` files, as another extension would register it.
 * The line `a.b.c = 1` visits `a`, `a.b` and `a.b.c`, each highlighting its own part of the key.
 * It reuses one path array for the nodes of a line, as `VisitKeyPath` allows.
 */
export const propertiesFiles: KeyPathFiles = {
    id: "propertiesKeyPath",
    languageIds: ["properties"],
    extensions: [".properties"],
    readKeys(text, visit) {
        for (const found of text.matchAll(KEY)) {
            const key = found[1]!
            let partStart = found.index + found[0].length - key.length
            const path: string[] = []
            for (const part of key.split(".")) {
                path.push(part)
                visit(path, partStart, partStart + part.length)
                partStart += part.length + 1
            }
        }
    }
}
