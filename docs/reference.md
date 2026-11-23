# Search++ reference

## Query language

Type a query into the Search++ view.
The search runs once typing pauses, or at once on Enter.
A line under the query input says how Search++ reads the query, such as `Searching as a regex.`

- `grav` finds `Gravitee`, since a query word matches in any case and inside words.
- `secret` finds `socket`, since a query word also matches words a letter or two off.
- `Größe` and `Groesse` find each other, since an umlaut and its spelled-out form match in both directions.
- `config.server.port` finds `this.config.server.port` and `config?.server.port` in TypeScript and JavaScript, also across lines.
- `staging namespace` finds `namespace` alone in the files under a folder `staging`, on top of the lines that match the whole query in any file.
  A word that starts a word of the file path counts as found in that file.
  The other words search its lines.
  A word may hold slashes, as `apps/staging` does.
- `apps/web` finds the folder `deploy-apps/web-dev`, since a query with a slash matches across the folders of a path.
  A match must end inside the last name of the path, which leaves out the files below `web-dev`.
  A matched name shows highlighted in its row.
  In the list, a folder with results below it takes no row of its own: the rows below it highlight its name.
  A click on a folder without results below it selects that folder in the Explorer.
- `"Größe"` finds `Größe` alone, since double quotes match a word exactly: in its own case, without umlaut variants and without typos.
- `console.log(*)` finds every call of `console.log`, since `*` stands for any run of characters inside one line.
- `import \* as fs` finds a literal star, since `\` escapes the next character.
- `values.*.enabled` finds `values.gateway.enabled` and `values.portal.enabled`.
- `**.enabled` finds every `enabled` key at any depth.
- `values.{gateway,portal}.enabled` finds both toggles and leaves out `values.ui.enabled`.
- `ingress.hosts.0` finds the first host, since a list item takes its index as its key, counted from 0.
- `metadata.labels."app.kubernetes.io/name"` finds a key that holds dots.
- `/4\.\d+\.\d+/` finds version numbers with the [syntax of the Rust `regex` crate](https://docs.rs/regex/latest/regex/#syntax), which ripgrep uses.

A file whose path holds all or none of the words gets searched for the whole query alone.
A quoted word, a word with `*` or `\` and a single letter search lines alone.

A key path takes the [VS Code glob syntax](https://code.visualstudio.com/docs/editor/glob-patterns), with `.` in place of `/`.
It searches YAML, JSON and TOML files.
A dotted query also runs as plain text: `example.com` finds the text `example.com` in every file.
A key path match shows its path at the right edge of its row.
A regex query skips the matching settings and the key path search.
It matches case-sensitively, unless it starts with `(?i)`.

The context menu of a match says why it matched, such as `Gröse: 1 letter off from Größe.`

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

The `...` menu in the view title turns case, whole words, umlaut variants and typos on and off.
The gear in the view title opens these settings.

Every search includes the files that `.gitignore`, the other ignore files and `search.exclude` hide.
It leaves out the `.git` folders, the globs of `files.exclude` and the globs of `searchPlusPlus.exclude`.

## Ctrl+Shift+F

Search++ binds Ctrl+Shift+F (Cmd+Shift+F on macOS) to its view.
Pressed in an editor, it puts the selected text into the query and searches it, as the built-in Search view does.
A selection over several lines leaves the query as it stands.
With `search.seedWithNearestWord` on, the word at the cursor fills the query when nothing is selected.
`editor.find.seedSearchStringFromSelection` set to `never` turns the selection off.
To hide the built-in Search view, right-click the activity bar and uncheck Search.

If another extension or one of your keybindings takes Ctrl+Shift+F, add the binding to your keyboard shortcuts (command `Preferences: Open Keyboard Shortcuts (JSON)`):

```jsonc
// keybindings.json
[{ "key": "ctrl+shift+f", "command": "searchPlusPlus.focus" }]
```

To give Ctrl+Shift+F back to the built-in Search view, bind `-searchPlusPlus.focus` to it in the same file.
