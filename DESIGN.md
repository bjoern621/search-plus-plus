# Search++ design

This document records the decisions behind Search++, a VS Code extension that takes over the job of the built-in Search view.
Each decision takes one line.
Open questions sit at the end until we settle them.

## Goal

Search stays as simple as the built-in Search view: type text, read results.
Search++ reads the intent from the query and the file type.
Most searches need no option.
Structural search feels like typing plain text.

## Importance

Each feature gets one of three levels.
The level decides how far the view keeps the feature from the query input.

| Level    | Place in the view                 |
| -------- | --------------------------------- |
| Core     | visible at all times              |
| Frequent | one click away, or shown on hover |
| Rare     | in a menu or in the settings      |

| Feature                              | Level    | Place                                                                          |
| ------------------------------------ | -------- | ------------------------------------------------------------------------------ |
| Query input                          | Core     | top of the view                                                                |
| Results as a list of files           | Core     | under the query input                                                          |
| Key path search                      | Core     | works without a control                                                        |
| Matching defaults                    | Core     | work without a control                                                         |
| Context lines around each match      | Core     | one line before and after, dimmed, a line of whitespace left out               |
| Hints on the query                   | Core     | one line under the query input, shown when they apply                          |
| Wildcard `*`                         | Core     | works without a control                                                        |
| Query highlighting                   | Core     | colors in the query input                                                      |
| Exclude buttons on folders and files | Frequent | on hover over a result                                                         |
| Context menu on a match              | Frequent | on right-click on a match                                                      |
| Results as a list or a folder tree   | Frequent | View As menu in the view title                                                 |
| Files to include and exclude         | Frequent | behind the `…` button right of the query input, opened once an exclusion lands |
| Matching defaults on and off         | Rare     | in the `...` menu of the view title, a check marking each one that holds       |
| Search ignored files on and off      | Rare     | in the `...` menu of the view title, a check marking it while it holds         |
| Settings for the matching defaults   | Rare     | behind the gear in the view title                                              |

The empty query input shows the placeholder `Search`, as the built-in Search view does.
The file fields show examples in their placeholders, such as `Examples: *.yaml, ./charts`.
The file fields take the font size of the query input. Their labels take the small size of a description.
An input holding text shows a trash button at its right edge, which empties it and searches again.

As in the built-in Search view, typing in the query input or the file fields searches once typing pauses for `search.searchOnTypeDebouncePeriod`, while `search.searchOnType` stays on.
Enter searches at once.
Switching to the view selects the query, so typing replaces it, as Ctrl+Shift+F does in the built-in Search view.
A keystroke cancels the search that runs.
An empty query clears the results.
A query enters the search history on Enter or once no other search replaced it for two seconds, as in the built-in Search view.
Every search leaves out the `.git` folders, the globs that `files.exclude` turns on and the globs of `searchPlusPlus.exclude`.
It leaves out the files that the ignore files hide, such as `node_modules` under a `.gitignore`, since they multiply the files to read.
`searchPlusPlus.searchIgnoredFiles` searches them as well.
The `...` menu of the view title turns it on and off.
`search.useParentIgnoreFiles` and `search.useGlobalIgnoreFiles` add the ignore files above the folder and the global one, as in the built-in Search view.
Every search covers the files that `search.exclude` hides.
A `files.exclude` glob with a `when` condition stays searched.

## Results

- Each match shows its line with the line number, as in the editor.
- One line before and one after the match frame it, dimmed.
  The settings change the number of context lines.
- Context of two close matches merges into one block.
- A search stops once `searchPlusPlus.maxResults` lines matched and says so under the results.
- A thin divider above a code line marks the lines skipped since the code line above it in the same file, so lines 16 and 33 never read as neighbors.
  It adds no height and takes the color of the indent guides in the editor (`editorIndentGuide.background1`), which VS Code defines for every kind of theme.
  A hover or selection outline ending at the divider covers it, so the two draw as one line.
- Up and Down move between folders, files and matched lines and pass over the context lines, since the built-in Search view shows none.
  As in the built-in Search view, Up and Down in the query input walk the search history.
  Ctrl+Down moves into the results, through files to include and files to exclude while they show.
- The View As menu in the view title lays the results out as a list or as a folder tree, as View as List and View as Tree do in the built-in Search view.
  The menu grays out the current layout.
  Each workspace keeps its layout across reloads, starting with the list.
- The list shows every file at the top, sorted by its path folder by folder, the files of a folder before its subfolders.
  It shows the path of a file relative to its workspace folder: `charts/apim/values.yaml`.
  It dims the folders before the file name.
  A narrow side bar drops whole folders from the front of the path and keeps the file name whole: `…/apim/values.yaml`.
  Files sharing a name keep the folders that tell them apart until last, and a run of dropped folders shows as one `…`: `…/atticd-speed/…/docs.md`.
  Those folders sit in the same section of every path, counted from the first folder or from the file, whichever tells more paths apart.
  In a multi-root workspace, the folders start with the name of the workspace folder.
- In the tree, folders nest as in the explorer, subfolders before files.
  A chain of folders without matched files of their own shares one row, such as `charts/apim`.
  A chain that leads to one file and nothing else folds into the row of that file: `docs.md` followed by `atticd-speed/argocd/applications/gitlab`, dimmed.
  A folder keeps its row where the tree branches, meaning where it holds two or more folders or files, so `.claude/worktrees` stays a row above two worktrees.
  A narrow side bar cuts the dimmed folders at their end and keeps the file name whole, since the first folders tell two files of one name apart.
- Folder and file rows step right of their parent by `workbench.tree.indent`.
  The indentation alone shows the nesting.
- Code lines start at the left edge at any depth, so they take the full width of the side bar.
- Each block of code lines, meaning a match with its context, drops the indentation that all its lines share.
  The least indented line starts at the left edge, and the others keep their indentation relative to it.
  Tabs count to the next tab stop, so lines that mix tabs and spaces still line up.
- A match line whose match would end past the edge of the row loses the text before the match.
  The row keeps its indentation, then the text from a word boundary about a third of the row before the match.
  The `…` marking the cut hangs in the gap after the line number, so the text keeps the column of the lines around it.
  The row keeps its indentation in every case, so it lines up with the other rows of its block.
  Rows that fit keep their whole text, and a resize cuts anew.
- Folder and file rows take their icons from the active file icon theme, as the explorer shows them.
  The theme picks the icon by file name, extension, language and the open or closed state of a folder.
  A compacted folder row such as `charts/apim` shows the icon of its last folder.
  A theme that gives a folder no icon, such as Seti, leaves its row without an icon slot, so the folder name starts where the file icons of the same depth start, as in the built-in Search view.
  With the icon theme set to None, rows keep an empty icon slot, so the labels of one depth stay aligned.
- A match of a key in a YAML, JSON or TOML file shows its key path after the line, such as `gateway.image.tag`, once the query uses the key path language.
  Such a query holds two or more keys (an index counts as a key), `**`, `*`, `?`, a class, a group, quotes or an escaped operator.
  A single plain word such as `gateway` shows no path on the keys that it matches, since such a query reads as a text search.
  The path takes the dimmed small font of the workbench and sits at the right edge of the row.
  A key holding a dot appears in quotes, as a query writes it.
  The line keeps its room: on a narrow side bar the path drops whole keys after its first key, so its first and last keys stay in view.
  An ellipsis between thin spaces takes the place of the dropped keys and the dots around them: `gateway … limits.memory`.
  Once the first and the last key leave too little room, the path drops the first key and its dot as well: `…memory`.
  Without room for the last key, the path hides.
  A member chain in code shows no path, since its line spells the chain.
- Results carry no ranking: files follow their paths, matches follow their line numbers.
- A fuzzy match looks like an exact match.
- Folders and files carry no result count.
  The summary line holds the total.
- Clicking any line of a block opens the file at its match, with the matched text selected.

### Context menu

Right-clicking a match opens a context menu.
Right-clicking a context line opens the menu of the match in its block, so every line of a block offers the same items.
Its top lines say why the line matched whenever a matching default stretched the query:

- `Gröse: 1 letter off from Größe.`
- `Groesse: Größe written without umlauts.`
- `Key gravitee: 1 letter off from Gravite.`

Below them come the quick actions:

| Action                  | Shown for                                 | Effect                                                                            |
| ----------------------- | ----------------------------------------- | --------------------------------------------------------------------------------- |
| Match "(word)" exactly  | a match that a matching default stretched | puts the query word in quotes and searches again                                  |
| Exclude (file)          | every match                               | adds the file to files to exclude                                                 |
| Exclude folder (folder) | every match                               | adds the folder to files to exclude                                               |
| Copy line               | every match                               | copies the line of the match                                                      |
| Copy key path           | a key path match                          | copies the key path of the matched node, such as `global.values.gravitee.enabled` |

## Place in VS Code

- Search++ brings its own view, since VS Code lets no extension replace the built-in Search view (`TextSearchProvider` stays a proposed API and skips `file://` files).
- The view sits in the side bar.
  A popover over the editor would have to use the VS Code Quick Pick, which shows a flat list and offers no tree.
- The view renders in a webview, which draws the inputs and the dimmed context lines.
- The view follows the color theme of VS Code.
  Rows, inputs and menus take the theme colors of their counterparts in the explorer, the Search view and the editor.
  Hover and selection draw one rounded outline around a group of rows and fill none of them.
  A folder or file groups the rows inside it. A code line groups its match with the context lines.
  The hover outline takes the color that the explorer fills a hovered row with.
  The selection outline takes the text color, so it stands out more than the hover outline.
  It shows after a key press in the results and hides on a click, as a `:focus-visible` outline does.
- Twisties and buttons take their icons from the codicon font of the workbench (`@vscode/codicons`), so they match the icons of the built-in views.
  A twisty sits where the workbench trees place theirs, with the chevron 16px wide and 6px before the file icon.
- Code lines take the family and weight of the editor font at the size of the workbench font, in rows as high as the folder and file rows.
  The built-in Search view draws its result lines at that size and height as well, so code and file rows read as one list.
  Every other text takes the font of the workbench.
  A change of color theme or editor font redraws the view without a new search.
- To make it the default, hide the built-in Search view and bind Ctrl+Shift+F to Search++.
- The view gets written from scratch, since the built-in Search view lives in VS Code core and exposes none of its widgets to extensions.
- The view keeps the core of the built-in Search view: query input, files to include and exclude, results as a list or a folder tree.
- Replace stays with the built-in Search view.
- Further features of the built-in view come back on demand.
- The input keeps the text that you typed, for example `global.values.gravitee.enabled`, whatever query runs underneath.

## Matching

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

A word in double quotes matches exactly: case-sensitive, without umlaut variants and without fuzzy matches.
`"Größe"` finds `Größe` alone.
The context menu on a close match offers the quotes.

Each default has a setting:

- `searchPlusPlus.matchCase` keeps a word to its own case.
  A word that differs in case alone never counts as a close spelling then.
- `searchPlusPlus.matchWholeWord` keeps a word to whole words of a line.
  Key paths compare whole keys either way.
- `searchPlusPlus.umlautVariants` turns the umlaut variants off.
- `searchPlusPlus.fuzzy` turns the fuzzy matches off.
  `searchPlusPlus.fuzzyOneEditMinLetters` and `searchPlusPlus.fuzzyTwoEditsMinLetters` set the word lengths that allow one and two edits.

A regex query follows none of these settings.
The `...` menu of the view title turns the four on and off as well.
A changed setting runs the last search again.

### Wildcard

- Outside a regex, `*` stands for any run of characters inside one line.
- In code, `console.log(*)` finds every call of `console.log`, whatever its arguments.
- `\*` finds a literal star: `import \* as fs`.
- A key path gives `*` the meaning of the key path language below.

### Fuzzy matching

Fuzzy matching copies the `AUTO` fuzziness of [Elasticsearch](https://www.elastic.co/guide/en/elasticsearch/reference/current/common-options.html#fuzziness).
An edit inserts, deletes or replaces one character, or swaps two neighbouring characters (Damerau-Levenshtein distance).
The length of a query word sets the edits that it allows:

| Word length          | Edits allowed |
| -------------------- | ------------- |
| 1 to 2 characters    | 0             |
| 3 to 5 characters    | 1             |
| 6 or more characters | 2             |

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

| Query                                 | Hint                                                                        |
| ------------------------------------- | --------------------------------------------------------------------------- |
| between two slashes                   | Searching as a regex. (highlighted)                                         |
| starts with a slash, ends without one | End with a slash to search as a regex.                                      |
| breaks the key path grammar           | Key path search is off because a bracket ([) stays open. Close it with ].   |
| regex that does not compile           | The regex cannot compile: (parser's message). Fix it or remove the slashes. |

A hint that suggests a query runs it on click.

A query that breaks the key path grammar still runs in the other search engines.
A regex that does not compile runs no search.
A hint that stopped the search shows in the error colors of an input, as the built-in Search view shows a broken regex.

## Search engines

- A search engine reads a query and a file and returns its matches.
- Each search engine sits in its own module behind one interface.
- Other VS Code extensions add search engines through the API that Search++ exports from its `activate` function.
- A search engine declares the file types and the queries that it accepts.
- Every query runs in every search engine that accepts it.
  `example.com` runs the plain text engine in every file and the key path engines in YAML, JSON and TOML files.
- The results list the matches of all search engines together.
  A line that several search engines find shows once.
- The plain text engine accepts every file, so a file type without an engine of its own still gets results.
- The first version brings search engines for plain text, regex and key paths in YAML, JSON and TOML.
- The search engines get picked during implementation.
  Candidates: the ripgrep that ships with VS Code, ugrep for fuzzy matching, `@ast-grep/napi` for code and the `yaml`, `jsonc-parser` and `toml-eslint-parser` packages for key paths.

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
  A row that folds its folders in carries the button of its file.
  The context menu of its matches excludes the folder.
- Excluding adds the folder or file to files to exclude and drops its results without a new search.
- Removing the entry from files to exclude brings its results back.

## Configuration

- Search++ reads no per-project config file.
- Every option lives in the VS Code settings and works with its default.

## Dependencies

- The repository keeps a software bill of materials (SBOM) in the CycloneDX JSON format.
- The SBOM lists every package and every binary that the extension ships.
- The build regenerates the SBOM from the lockfile.
- CI fails when the committed SBOM differs from the regenerated one, so every dependency change updates the SBOM in the same commit.

## Out of scope

- Helm cross-references between `values.yaml` and templates belong in a separate extension.
- Search in other branches and in the Git history belongs in a separate extension.
- Replace stays with the built-in Search view until a need comes up.
- Refining by content, conditions across one YAML document, proximity search, case variants of identifiers, keys-only search and skipping comments stay out until a need comes up.
