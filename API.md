# Search++ API

This page describes how another VS Code extension adds key path search for a file type or a search engine of its own to Search++.
The `activate` function of Search++ returns the API.
[`src/api.ts`](src/api.ts) holds every type of it, each documented in place.
The file imports nothing.
You may copy it into your extension.

## Get the API

Declare Search++ as a dependency in the manifest of your extension:

```json
// package.json
"extensionDependencies": ["bjoern621.searchplusplus"]
```

Fetch the API in your `activate` function and register what your extension brings:

```ts
// src/extension.ts
import * as vscode from "vscode"
import { API_VERSION, type SearchPlusPlusApi } from "./searchPlusPlusApi"
import { iniFiles } from "./iniFiles"

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const api = await vscode.extensions
        .getExtension<SearchPlusPlusApi>("bjoern621.searchplusplus")
        ?.activate()
    if (api?.apiVersion !== API_VERSION) return
    context.subscriptions.push(api.registerKeyPathFiles(iniFiles))
}
```

`apiVersion` grows by one with each change that breaks an extension written against an earlier version.
A new member keeps the number.
To call a member that later versions add, check for it first, for example with `"registerKeyPathFiles" in api`.
A registration holds for every search that starts after it.
A search already running keeps its engines.
Disposing it removes the engine or the file type.

## Key path search for a file type

`registerKeyPathFiles` takes a file type and a function that reads the keys of its files.
Search++ does the rest as for YAML, JSON and TOML.
It applies the key path grammar and the matching defaults for case, umlauts and typos.
It fills the reasons in the context menu of a match, the key path on the row and "Copy key path".
The JSON and TOML search of Search++ runs through the same hook.

This file type reads INI files with sections:

```ts
// src/iniFiles.ts
import type { KeyPathFiles } from "./searchPlusPlusApi"

const SECTION = /^\s*\[([^\]]+)\]/
const KEY = /^\s*([^=;#\s][^=]*?)\s*=/

export const iniFiles: KeyPathFiles = {
    id: "iniKeyPath",
    languageIds: ["ini"],
    extensions: [".ini", ".cfg"],
    readKeys(text, visit) {
        let section: string[] = []
        let lineStart = 0
        for (const line of text.split("\n")) {
            const header = SECTION.exec(line)
            const key = header ? undefined : KEY.exec(line)
            if (header) {
                section = [header[1]!]
                const start = lineStart + line.indexOf(header[1]!)
                visit(section, start, start + header[1]!.length)
            } else if (key) {
                const start = lineStart + line.indexOf(key[1]!)
                visit([...section, key[1]!], start, start + key[1]!.length)
            }
            lineStart += line.length + 1
        }
    }
}
```

In this file, the query `server.port` finds the key `port` below `[server]`.
`serve.port` finds it as well, with a fuzzy match on `server`.
`**.port` finds both `port` keys.

```ini
[server]
port = 8080

[database]
port = 5432
```

`readKeys` must follow these rules:

- `visit` takes each node with its keys from the root, such as `["server", "port"]`.
  An array item takes its index as key, such as `"0"`.
- `start` and `end` mark the text that a match highlights, usually the key, as offsets into the file text in UTF-16 code units.
- Search++ reads the keys during the call alone.
  You may reuse the array for the next node.
- `readKeys` should read past broken parts.
  A file with a typo then still yields its other keys.
- `visit` throws once the search gets cancelled.
  Let that error leave `readKeys`.

Search++ asks a file type for the keys of a file whose language ID or extension matches, for every query that the key path grammar accepts.

## A search engine

`registerEngine` takes an engine that finds matches on its own.
`accepts` decides per file and query, without reading the file.
`search` returns the matches of a file.

This engine finds the lines of `.log` files whose log level equals the query, such as `error`:

```ts
// src/logLevelEngine.ts
import type { LineMatch, SearchEngine } from "./searchPlusPlusApi"

const LEVEL = /^\S+\s+([A-Z]+)\b/

export const logLevelEngine: SearchEngine = {
    id: "logLevel",
    accepts: (file, query) => query.kind === "text" && file.relativePath.endsWith(".log"),
    search(file, query) {
        const level = query.raw.toUpperCase()
        const matches: LineMatch[] = []
        file.text.split(/\r\n|\r|\n/).forEach((text, line) => {
            const found = LEVEL.exec(text)
            if (found?.[1] !== level) return
            const start = found[0].length - level.length
            matches.push({ line, ranges: [{ start, end: found[0].length }], reasons: [] })
        })
        return matches
    }
}
```

Register it with `context.subscriptions.push(api.registerEngine(logLevelEngine))`.

A search engine must follow these rules:

- A match names its line from 0, with lines ended by `\n`, `\r\n` or a lone `\r` as in VS Code.
  Its ranges count UTF-16 code units inside that line.
- `reasons` says why a match differs from the query, such as a fuzzy match.
  The context menu of the match shows it.
- `query.kind` tells a regex query from a text query.
  A text query carries the matching settings in `matching`.
- The `Query` type leaves out the key path of a text query.
  To search key paths, register a file type with `registerKeyPathFiles`.

Search++ writes an error that `accepts` or `search` throws to its output channel and searches on.
It drops a match outside the file.
Search++ shows a line once when several engines find it.
