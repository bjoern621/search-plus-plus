# Changelog

## Unreleased

### Added

- Ctrl+Shift+F in an editor puts the selected text into the query and searches it, as the built-in Search view does.
  A `*`, `\` or `"` in the selection matches itself, since the query takes it with a backslash.
  A selection over several lines leaves the query as it stands.

### Changed

- A click or double-click in the results selects no text, as in the lists of the workbench (a fast click on a folder could select its name).
- The context menu of a result line names its copy item Copy matched line (showed Copy line).
- The view title menu names its whole word item Match Whole Words Only (showed Match Whole Word).

### Fixed

- A click into the open view while another part of the window holds the focus keeps the focus where the click puts it (selected the whole query).

## v0.3.0 (2026-11-23)

### Added

- The search finds files and folders whose name matches the query, with the typos and umlaut spellings of the line search.
  Each matched name shows highlighted in its row and counts as one result.
  In the list, a folder with results below it takes no row of its own: the rows below it highlight its name.
  A click on a folder without results below it selects that folder in the Explorer.
  The context menu of a file or folder row offers Reveal in Explorer.
- A word of the query that starts a word of a file path counts as found in that file.
  The other words search its lines, on top of the whole query: `staging namespace` finds `namespace` alone in the files under `staging/`.
  A word may hold slashes, as `apps/staging` does.
- A result line with matches past the edge of its row shows their count, such as `+1`.
- Clicking a result line again, or pressing Enter on it again, opens its next match.
  The row scrolls to that match and marks it in the colors of the editor's current find match.
  Every click counts, however fast it follows the last one.
  A double-click keeps the editor open at the match that its second click selected.

### Changed

- In the tree, a file row shows the folders that fold into it before its name, dimmed as in the list: `web-dev/values.yaml` (showed `values.yaml web-dev`).
- The exclude buttons show the outlined circle-slash codicon again.
- The settings button in the view title shows the settings-gear icon of the VS Code settings buttons (a product icon theme drew three dots).

### Fixed

- After a restart or a reload of the window, the view runs the query of the last session again (showed the query without results).
- Under a theme without a selection color, such as Dark Modern, selected text in the inputs takes the color of the browser, as in the workbench (took the editor selection color).
- Under a theme without a menu border, the context menu takes the border color of the editor widgets, as the workbench menus do (took the widget border color).

## v0.2.0 (2026-11-22)

### Changed

- A search after the first one returns faster.
  The search workers keep the files that they read, with what the search derived from them, until a file changes.
  They keep up to 128 MiB of files, counted by their size on disk.
  A search takes the last list of files while no file got created or deleted and no ignore file changed.
- A click on a result line moves the focus into the editor, with the match selected.
  Space opens the file and keeps the focus in the results.
- The clear and exclude buttons show filled icons.
  The button for the files to include and exclude shows sliders in place of three dots.
  The three dots stay for the menu in the view title.

### Fixed

- A window without a workspace folder searches the files that its editor tabs show, as the built-in Search view does (showed "Open a folder to search it." and searched nothing).
- A divider inside a result block, where a blank line takes no row, separates the hover and selection outlines as well (both outlined the whole block).

## v0.1.2 (2026-11-20)

### Changed

- The extension ID changes to `bjoern621.searchplusplus`, since another extension on the Marketplace holds the name `search-plus-plus`.
  An extension that uses the API must name the new ID.

## v0.1.1 (2026-11-20)

### Changed

- The Marketplace lists the extension as Search Plus Plus, since another extension holds the name search++.

## v0.1.0 (2026-11-20)

### Added

- Search view in the activity bar, bound to Ctrl+Shift+F.
- Text search that matches in any case, inside words, across umlaut spellings and across a typo or two.
- Double quotes around a word to match it exactly.
- Key path search in YAML, JSON and TOML files, with globs such as `values.*.enabled` and `**.enabled`.
- Member chain search in TypeScript and JavaScript: `config.server.port` finds `this.config.server.port`.
- Regex search for a query between two slashes.
- Results as a list or a folder tree, with context lines, exclude buttons and a context menu that says why a line matched.
- Search on several cores, with the first results shown while the file listing still runs.
- Files hidden by `.gitignore` and the other ignore files stay out of a search, unless the view menu or `searchPlusPlus.searchIgnoredFiles` turns them on.
- Settings for each matching default, the excluded globs, the result limit and the context lines.
- An API for other extensions to add search engines.
