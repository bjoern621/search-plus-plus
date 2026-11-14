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
- A dotted key path follows the key path language below.

## Key path language

A dotted key path takes the [VS Code glob syntax](https://code.visualstudio.com/docs/editor/glob-patterns), with `.` in place of `/`.
The files to include field takes the same syntax, so VS Code users know it already.

### Grammar

The grammar uses EBNF as defined in ISO/IEC 14977.

```ebnf
path         = segment, { ".", segment } ;
segment      = "**" | piece, { piece } ;
piece        = literal | "*" | "?" | class | group ;
group        = "{", alternative, { ",", alternative }, "}" ;
alternative  = alt segment, { ".", alt segment } ;
alt segment  = "**" | alt piece, { alt piece } ;
alt piece    = alt literal | "*" | "?" | class ;
class        = "[", [ "!" | "^" ], class item, { class item }, "]" ;
class item   = class char, [ "-", class char ] ;
literal      = ? any character except ".", "*", "?", "[", "]", "{", "}" ? ;
alt literal  = ? any literal except "," ? ;
class char   = ? any character except ".", "]" ? ;
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
  - A literal matches itself.
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

- How does a key path name a key that holds a dot, such as the label `app.kubernetes.io/name`, given that VS Code globs offer no escape?
- Do case-insensitive matching, umlauts and fuzzy matching apply to key paths?
- What happens with a query that breaks the grammar, such as an unclosed `[`?
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
