# Changelog

## 0.0.1

First release.

- Search view in the activity bar, bound to Ctrl+Shift+F.
- Text search that matches in any case, inside words, across umlaut spellings and across a typo or two.
- Double quotes around a word to match it exactly.
- Key path search in YAML, JSON and TOML files, with globs such as `values.*.enabled` and `**.enabled`.
- Member chain search in TypeScript and JavaScript: `config.server.port` finds `this.config.server.port`.
- Regex search for a query between two slashes.
- Results as a list or a folder tree, with context lines, exclude buttons and a context menu that says why a line matched.
- Settings for each matching default, the excluded globs, the result limit and the context lines.
- An API for other extensions to add search engines.
