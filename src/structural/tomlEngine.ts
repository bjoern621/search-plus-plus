import { keyPathEngine } from "./keyPathEngine"
import { readTomlKeys } from "./tomlKeys"

/**
 * Finds key paths in TOML files.
 * Every key as written counts as an occurrence of its node.
 * `[a.b]` and `[a.c]` both hold the node `a`, so `a` matches on both lines.
 * An array of tables numbers its tables from 0: the second `[[products]]` holds `products.1`.
 */
export const tomlEngine = keyPathEngine({
    id: "tomlKeyPath",
    languageIds: ["toml"],
    extensions: [".toml"],
    readKeys: readTomlKeys
})
