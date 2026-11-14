# Better Search design

This document records the decisions behind Better Search, a VS Code extension that takes over the job of the built-in Search view.
Each decision takes one line.
Open questions sit at the end until we settle them.

## Goal

Search stays as simple as the built-in Search view: type text, press Enter, read results.
Better Search reads the intent from the query and the file type.
Most searches need no option.
Structural search feels like typing plain text.

## Place in VS Code

- Better Search brings its own view, since VS Code lets no extension replace the built-in Search view (`TextSearchProvider` stays a proposed API and skips `file://` files).
- The view sits in the side bar.
  A popover over the editor would have to use the VS Code Quick Pick, which shows a flat list and offers no tree and no replace input.
- To make it the default, hide the built-in Search view and bind Ctrl+Shift+F to Better Search.
- The view gets written from scratch, since the built-in Search view lives in VS Code core and exposes none of its widgets to extensions.
- The view keeps the core of the built-in Search view: query input, replace input, files to include and exclude, results in a folder tree.
- Further features of the built-in view come back on demand.
- The input keeps the text that you typed, for example `global.values.gravitee.enabled`, whatever query runs underneath.

## Matching

The input carries no toggles.
A query matches with these defaults:

- Case-insensitive.
- Inside words: `grav` finds `gravitee`.
- Umlauts: each umlaut also matches its spelled-out form.
  - `ä` matches `ae`.
  - `ö` matches `oe`.
  - `ü` matches `ue`.
  - `ß` matches `ss`.
- Fuzzy: text that sits a few typos away from the query matches as well.

The extension settings change each default.

## Structural search

Structural search matches by the structure of a file: keys in YAML, JSON and TOML, syntax in code.

- The query stays plain text, without metavariables (placeholders that stand for any code, such as ast-grep's `$A`) or the templates of IntelliJ's Structural Search and Replace.
- The file type decides how a query reads: a dotted key path in YAML, JSON and TOML, code in every other language.
- A dotted key path matches the key at that position in the tree: `global.values.gravitee.enabled` finds `enabled` under `gravitee` under `values` under `global`.
  An `enabled` anywhere else stays out of the results.
- `*` in a dotted key path stands for any single key ("wildcard"): `values.*.enabled`.

## Excluding results

- Every folder and file in the results carries an exclude button.
- Excluding adds the folder or file to files to exclude and drops its results without a new search.
- Removing the entry from files to exclude brings its results back.

## Scope

A scope selector picks where the search runs:

- Working tree (the default)
- Files changed against the default branch
- Another branch
- Git history

The branch and history scopes read Git without a checkout.
The history scope groups results by commit.

## Configuration

- Better Search reads no per-project config file.
- Every option lives in the VS Code settings and works with its default.

## Out of scope

- Helm cross-references between `values.yaml` and templates belong in a separate extension.
- Refining by content, conditions across one YAML document, proximity search, case variants of identifiers, keys-only search, skipping comments and searching ignored folders stay out until a need comes up.

## Open questions

- Does `**` in a dotted key path match any number of keys, as in globs (`global.**.enabled`)?
- Which wildcard does code use, given that `*` already means multiplication, dereference and `import *` in many languages?
- Does `a.b.c` in a code file match member access, or a key path inside a JSON or YAML literal as well?
- Do umlauts match in both directions, given that `ae` to `ä` hits words such as "Israel" and "aerial"?
- How many typos does fuzzy matching allow?
- How do exact matches stand out from fuzzy ones in the results?
- How does a query ask for a regex, given that the input carries no regex toggle?
- When does a query in a code file run as structural search, given that the input carries no structure toggle?
- Which engines run each mode? Candidates: the ripgrep that ships with VS Code, ugrep for fuzzy matching, `@ast-grep/napi` for code, the `yaml`, `jsonc-parser` and `toml-eslint-parser` packages for key paths, `git grep` and `git log -G` for branches and history.
- Does replace work in structural, fuzzy and history scopes, or only for plain text and regex?
- Does structural search in a file type without a parser fall back to plain text or skip the file?
