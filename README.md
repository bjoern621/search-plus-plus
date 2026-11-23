# Search++

Search++ searches the files of a VS Code workspace from its own view in the activity bar.
Typos and umlaut spellings match by default.
A dotted query also finds keys in YAML, JSON and TOML files and member chains in TypeScript and JavaScript.

## What it does

- Finds text in any case and inside words: `grav` finds `Gravitee`.
- Finds words a letter or two off: `secret` finds `socket`.
- Finds an umlaut and its spelled-out form in both directions: `Größe` and `Groesse` find each other.
- Finds keys by their path in YAML, JSON and TOML files: `gateway.image.tag` finds `tag` under `image` under `gateway`.
- Finds member chains in TypeScript and JavaScript: `config.server.port` finds `this.config.server.port` and `config?.server.port`, also across lines.
- Runs a query between two slashes as a regex: `/4\.\d+\.\d+/`.
- Shows the results as a list of files or as a folder tree, with dimmed context lines around each match.
- Says in the context menu of a match why it matched, such as `Gröse: 1 letter off from Größe.`

Replace stays with the built-in Search view.
Search++ needs VS Code 1.100 or later.

## Query language

Type a query into the Search++ view.
The search runs once typing pauses, or at once on Enter.
A line under the query input says how Search++ reads the query, such as `Searching as a regex.`

- `staging namespace` finds `namespace` in the files under a folder `staging`, since a word that starts a word of the file path picks the files.
  The other words search their lines.
  A word may hold slashes, as `apps/staging` does.
- `"Größe"` finds `Größe` alone, since double quotes match a word exactly: in its own case, without umlaut variants and without typos.
- `console.log(*)` finds every call of `console.log`, since `*` stands for any run of characters inside one line.
- `import \* as fs` finds a literal star, since `\` escapes the next character.
- `values.*.enabled` finds `values.gateway.enabled` and `values.portal.enabled`.
- `**.enabled` finds every `enabled` key at any depth.
- `values.{gateway,portal}.enabled` finds both toggles and leaves out `values.ui.enabled`.
- `ingress.hosts.0` finds the first host, since a list item takes its index as its key, counted from 0.
- `metadata.labels."app.kubernetes.io/name"` finds a key that holds dots.
- `/4\.\d+\.\d+/` finds version numbers with the [syntax of the Rust `regex` crate](https://docs.rs/regex/latest/regex/#syntax), which ripgrep uses.

A query whose words all or none sit in the path of a file searches that file for the whole query.
A quoted word, a word with `*` or `\` and a single letter search lines alone.

A key path takes the [VS Code glob syntax](https://code.visualstudio.com/docs/editor/glob-patterns), with `.` in place of `/`.
A dotted query also runs as plain text: `example.com` finds the text `example.com` in every file.
A key path match shows its path at the right edge of its row.
A regex query skips the matching settings and the key path search.
It matches case-sensitively, unless it starts with `(?i)`.

## Settings

| Setting                                  | Default | Effect                                                       |
| ---------------------------------------- | ------- | ------------------------------------------------------------ |
| `searchPlusPlus.matchCase`               | `false` | A query word finds only text in its own case.                |
| `searchPlusPlus.matchWholeWord`          | `false` | A query word finds only whole words.                         |
| `searchPlusPlus.umlautVariants`          | `true`  | Each umlaut and its spelled-out form find each other.        |
| `searchPlusPlus.fuzzy`                   | `true`  | A query word also finds words a letter or two off.           |
| `searchPlusPlus.fuzzyOneEditMinLetters`  | `3`     | A query word this long or longer may differ by one letter.   |
| `searchPlusPlus.fuzzyTwoEditsMinLetters` | `6`     | A query word this long or longer may differ by two letters.  |
| `searchPlusPlus.exclude`                 | `[]`    | Every search leaves out these globs of files and folders.    |
| `searchPlusPlus.maxResults`              | `10000` | A search stops after this many matched lines.                |
| `searchPlusPlus.contextLines`            | `1`     | Each match shows this many dimmed lines before and after it. |

The `...` menu in the view title turns case, whole word, umlaut variants and typos on and off.
The gear in the view title opens these settings.

Every search includes the files that `.gitignore`, the other ignore files and `search.exclude` hide.
It leaves out the `.git` folders, the globs of `files.exclude` and the globs of `searchPlusPlus.exclude`.

## Make it the Ctrl+Shift+F default

Search++ binds Ctrl+Shift+F (Cmd+Shift+F on macOS) to its view.
To hide the built-in Search view, right-click the activity bar and uncheck Search.

If another extension or one of your keybindings takes Ctrl+Shift+F, add the binding to your keyboard shortcuts (command `Preferences: Open Keyboard Shortcuts (JSON)`):

```jsonc
// keybindings.json
[{ "key": "ctrl+shift+f", "command": "searchPlusPlus.focus" }]
```

To give Ctrl+Shift+F back to the built-in Search view, bind `-searchPlusPlus.focus` to it in the same file.

## Extending Search++

A search engine reads a query and a file and returns its matches.
Other extensions add search engines through the API that Search++ exports.
[API.md](API.md) describes the API.

## License

[MIT](LICENSE)
