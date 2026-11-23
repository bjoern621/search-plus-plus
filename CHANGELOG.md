# Changelog

## Unreleased

### Added

- A result line with matches past the edge of its row shows their count, such as `+1`.
- Clicking a result line again, or pressing Enter on it again, opens its next match.
  The row scrolls to that match and marks it in the colors of the editor's current find match.
  Every click counts, however fast it follows the last one.
  A double-click keeps the editor open at the match that its second click selected.

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
