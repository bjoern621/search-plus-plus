# Structural Search design

This document records the decisions behind Structural Search, a VS Code extension that takes over the job of the built-in Search view.
Each decision takes one line.
Open questions sit at the end until we settle them.

## Goal

Search stays as simple as the built-in Search view: type text, press Enter, read results.
Structural Search reads the intent from the query and the file type.
Most searches need no option.
Structural search feels like typing plain text.

## Importance

Each feature gets one of three levels.
The level decides how far the view keeps the feature from the query input.

| Level | Place in the view |
|---|---|
| Core | visible at all times |
| Frequent | one click away, or shown on hover |
| Rare | in a menu or in the settings |

| Feature | Level | Place |
|---|---|---|
| Query input | Core | top of the view |
| Results in a folder tree | Core | under the query input |
| Key path search | Core | works without a control |
| Matching defaults | Core | work without a control |
| Context lines around each match | Core | one line before and after, dimmed |
| Hints on the query | Core | one line under the query input, shown when they apply |
| Wildcard `*` | Core | works without a control |
| Query highlighting | Core | colors in the query input |
| Exclude buttons on folders and files | Frequent | on hover over a result |
| Larger excerpt around a match | Frequent | on hover over a match |
| Context menu on a match | Frequent | on right-click on a match |
| Files to include and exclude | Frequent | behind the `…` button right of the query input, opened once an exclusion lands |
| Scope | Rare | menu at the end of the results summary line |
| Settings for the matching defaults | Rare | behind the gear in the view title |

The summary line shows a scope other than the working tree in color, so a history search never passes for a working tree search.

## Results

- Each match shows its line with the line number, as in the editor.
- One line before and one after the match frame it, dimmed.
  The settings change the number of context lines.
- Context of two close matches merges into one block.
- Rows carry no indentation: folders, files and lines start at the same left edge, so the lines take the full width of the side bar.
- Results carry no ranking: files follow the folder tree, matches follow their line numbers.
- A fuzzy match looks like an exact match.
- Folders and files carry no result count.
  The summary line holds the total.
- Hovering a match shows a larger excerpt of its file.

### Context menu

Right-clicking a match opens a context menu.
Its top lines say why the line matched whenever a matching default stretched the query:

- `Gröse: close spelling of Größe, 1 edit away.`
- `Groesse: spelled-out umlaut of Größe.`
- `Key gravitee: close spelling of Gravite, 1 edit away.`

Below them come the quick actions:

| Action | Shown for | Effect |
|---|---|---|
| Find "(word)" as written | a match that a matching default stretched | puts the query word in quotes and searches again |
| Exclude (file) | every match | adds the file to files to exclude |
| Exclude folder (folder) | every match | adds the folder to files to exclude |
| Copy line | every match | copies the line of the match |
| Copy key path | a key path match | copies the key path of the matched node, such as `global.values.gravitee.enabled` |

## Place in VS Code

- Structural Search brings its own view, since VS Code lets no extension replace the built-in Search view (`TextSearchProvider` stays a proposed API and skips `file://` files).
- The view sits in the side bar.
  A popover over the editor would have to use the VS Code Quick Pick, which shows a flat list and offers no tree.
- The view renders in a webview, which draws the inputs and the dimmed context lines.
  Its hover card stays as wide as the side bar.
- To make it the default, hide the built-in Search view and bind Ctrl+Shift+F to Structural Search.
- The view gets written from scratch, since the built-in Search view lives in VS Code core and exposes none of its widgets to extensions.
- The view keeps the core of the built-in Search view: query input, files to include and exclude, results in a folder tree.
- Replace stays with the built-in Search view.
- Further features of the built-in view come back on demand.
- The input keeps the text that you typed, for example `global.values.gravitee.enabled`, whatever query runs underneath.

## Matching

The input carries no toggles.
A query matches with these defaults:

- Case-insensitive.
- Inside words: `grav` finds `gravitee`.
- Umlauts: each umlaut and its spelled-out form match each other in both directions.
  - `ä` and `ae`
  - `ö` and `oe`
  - `ü` and `ue`
  - `ß` and `ss`

  `Größe` finds `Groesse`, and `Groesse` finds `Größe`.
- Fuzzy: each word of the query also matches a word a few edits away.

A word in double quotes matches as written: case-sensitive, without umlaut variants and without fuzzy matches.
`"Größe"` finds `Größe` alone.
The context menu on a close match offers the quotes.
The extension settings change each default.

### Wildcard

- Outside a regex, `*` stands for any run of characters inside one line.
- In code, `console.log(*)` finds every call of `console.log`, whatever its arguments.
- `\*` finds a literal star: `import \* as fs`.
- A key path gives `*` the meaning of the key path language below.

### Fuzzy matching

Fuzzy matching copies the `AUTO` fuzziness of [Elasticsearch](https://www.elastic.co/guide/en/elasticsearch/reference/current/common-options.html#fuzziness).
An edit inserts, deletes or replaces one character, or swaps two neighbouring characters (Damerau-Levenshtein distance).
The length of a query word sets the edits that it allows:

| Word length | Edits allowed |
|---|---|
| 1 to 2 characters | 0 |
| 3 to 5 characters | 1 |
| 6 or more characters | 2 |

## Regex

- A query between two slashes runs as a regex: `/4\.\d+\.\d+/`.
- The regex follows the [syntax of the Rust `regex` crate](https://docs.rs/regex/latest/regex/#syntax), which ripgrep uses.
- A regex query skips the matching defaults and the key path search engines.

## Query highlighting

The query input colors each character by its role, so you see which characters the search reads as operators.

- Operators show in a highlight color of the theme: `*`, `?`, `[`, `]`, `{`, `}`, the comma inside braces, the quotes around a quoted word and the slashes around a regex.
- A backslash that escapes the next character dims.
  The escaped character keeps the text color.
  In `"hello"` the quotes show as operators.
  In `\"hello\"` the backslashes dim and the quotes show as text.
- Inside a regex, metacharacters such as `.`, `+` and `(` show as operators.
  A backslash before a letter, such as `\d`, shows as an operator as well.
  A backslash before any other character dims, as in `\.`.

## Hints

A hint takes one line under the query input and names what the query does or how to change it.

| Query | Hint |
|---|---|
| between two slashes | Searching as a regex. (highlighted) |
| starts with a slash, ends without one | End with a slash to search as a regex. |
| breaks the key path grammar | The key path skips this query because a bracket ([) stays open. Close it with ]. |
| regex that does not compile | The regex cannot compile: (parser's message). Fix it or drop the slashes. |

A hint that suggests a query runs it on click.

A query that breaks the key path grammar still runs in the other search engines.
A regex that does not compile runs no search.

## Search engines

- A search engine reads a query and a file and returns its matches.
- Each search engine sits in its own module behind one interface.
- Other VS Code extensions add search engines through the API that Structural Search exports from its `activate` function.
- A search engine declares the file types and the queries that it accepts.
- Every query runs in every search engine that accepts it.
  `example.com` runs the plain text engine in every file and the key path engines in YAML, JSON and TOML files.
- The results list the matches of all search engines together.
  A line that several search engines find shows once.
- The plain text engine accepts every file, so a file type without an engine of its own still gets results.
- The first version brings search engines for plain text, regex and key paths in YAML, JSON and TOML.
- The search engines get picked during implementation.
  Candidates: the ripgrep that ships with VS Code, ugrep for fuzzy matching, `@ast-grep/napi` for code, the `yaml`, `jsonc-parser` and `toml-eslint-parser` packages for key paths, `git grep` and `git log -G` for branches and history.

## Structural search

Structural search matches by the structure of a file: keys in YAML, JSON and TOML, syntax in code.

- The query stays plain text, without metavariables (placeholders that stand for any code, such as ast-grep's `$A`) or the templates of IntelliJ's Structural Search and Replace.
- A dotted key path matches the key at that position in the tree: `global.values.gravitee.enabled` finds `enabled` under `gravitee` under `values` under `global`.
  An `enabled` anywhere else stays out of the key path results.
- In code, a dotted key path matches a chain of member accesses that holds its keys in a row.
  `config.server.port` finds `this.config.server.port`, `config?.server.port` and `config["server"].port`, also when the chain spans several lines.
- A dotted key path follows the key path language below.
- A Helm reference such as `.Values.global.domain` gets no special treatment: its leading dot breaks the key path grammar.
  The plain text engine still finds it in the templates.

## Key path language

A dotted key path takes the [VS Code glob syntax](https://code.visualstudio.com/docs/editor/glob-patterns), with `.` in place of `/`.
The files to include field takes the same syntax, so VS Code users know it already.
Two characters depart from VS Code globs to name a key that holds a dot or an operator:
- `\` escapes the next character.
- `"` quotes a run of characters.

### Grammar

The grammar uses EBNF as defined in ISO/IEC 14977.

```ebnf
path         = segment, { ".", segment } ;
segment      = "**" | piece, { piece } ;
piece        = literal | escape | quoted | "*" | "?" | class | group ;
group        = "{", alternative, { ",", alternative }, "}" ;
alternative  = alt segment, { ".", alt segment } ;
alt segment  = "**" | alt piece, { alt piece } ;
alt piece    = alt literal | escape | quoted | "*" | "?" | class ;
class        = "[", [ "!" | "^" ], class item, { class item }, "]" ;
class item   = class atom, [ "-", class atom ] ;
class atom   = class char | escape ;
escape       = "\", ? any character ? ;
quoted       = '"', { quoted char | escape }, '"' ;
literal      = ? any character except ".", "*", "?", "[", "]", "{", "}", '"', "\" ? ;
alt literal  = ? any literal except "," ? ;
class char   = ? any character except ".", "]", "\" ? ;
quoted char  = ? any character except '"', "\" ? ;
```

Groups don't nest, since VS Code closes a group at the first `}`.

### Meaning

- A YAML, JSON or TOML file holds a tree of nodes.
- The key path of a node lists the keys from the root down to that node.
- A sequence item takes its index as its key, counted from 0: `hosts.0` names the first host.
- A query matches a node when the whole pattern matches the whole key path of that node.
- A segment made of `**` alone matches zero or more keys.
  Several `**` in a row act as one.
- Every other segment matches exactly one key:
  - A literal matches itself under the matching defaults: case-insensitive, with umlaut variants.
  - A segment made of literals alone also matches a key a few edits away, as in fuzzy matching.
    `Global.Values.Gravite.Enabled` finds `global.values.gravitee.enabled`.
  - An escape matches the character after the `\`.
  - A quoted piece matches its characters as written, without the matching defaults: `"a.*"` matches the key `a.*` alone.
    `**."enabled"` leaves out `enable` and `Enabled`.
  - `*` matches zero or more characters.
  - `?` matches one character.
  - A class matches one character out of its items.
    `a-z` covers every character from `a` to `z`.
    A leading `!` or `^` negates the class.
  - A group matches when one of its alternatives matches.
    An alternative may span several keys: `{gateway.enabled,portal}`.

### Examples

- `global.values.gravitee.enabled` finds `enabled` under `gravitee` under `values` under `global`.
- `values.*.enabled` finds `values.gateway.enabled` and `values.portal.enabled`.
- `values.grav*.enabled` finds `values.gravitee.enabled`.
- `**.enabled` finds every `enabled` key at any depth.
- `values.{gateway,portal}.enabled` finds both toggles and leaves out `values.ui.enabled`.
- `ingress.hosts.0` finds the first host.
- `metadata.labels."app.kubernetes.io/name"` and `metadata.labels.app\.kubernetes\.io/name` both find the label `app.kubernetes.io/name`.

## Excluding results

- Every folder and file in the results carries an exclude button.
- Excluding adds the folder or file to files to exclude and drops its results without a new search.
- Removing the entry from files to exclude brings its results back.

## Scope

A menu at the end of the results summary line picks where the search runs:

- Working tree (the default)
- Files changed against the default branch
- Another branch
- Git history

The button names the scope that the search runs in, such as `Branch feature ▾`.
The branch and history scopes read Git without a checkout.
Files to include, files to exclude and the exclusions in the VS Code settings apply in every scope.

- The changed files scope searches the files that differ from the merge base with `main` or `master`, uncommitted and untracked files included.
- The branch scope lists the branches in a quick pick, the most recent commit first.
- The history scope searches the lines that the latest commits on HEAD added or changed.
  `HISTORY_COMMIT_LIMIT` in `src/search/config.ts` sets how many commits it reads.
- The history scope groups results by commit, the newest first.
  A commit row shows the short hash, the subject, the author and the day.
- A result from a branch or a commit opens read-only at the match.
- Outside a Git repository, the menu shows the Git scopes disabled and says why.

## Configuration

- Structural Search reads no per-project config file.
- Every option lives in the VS Code settings and works with its default.

## Dependencies

- The repository keeps a software bill of materials (SBOM) in the CycloneDX JSON format.
- The SBOM lists every package and every binary that the extension ships.
- The build regenerates the SBOM from the lockfile.
- CI fails when the committed SBOM differs from the regenerated one, so every dependency change updates the SBOM in the same commit.

## Out of scope

- Helm cross-references between `values.yaml` and templates belong in a separate extension.
- Replace stays with the built-in Search view until a need comes up.
- Refining by content, conditions across one YAML document, proximity search, case variants of identifiers, keys-only search, skipping comments and searching ignored folders stay out until a need comes up.
