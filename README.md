<p align="center"><img src="media/icon.png" width="96" alt=""></p>

<h1 align="center">Search++</h1>

<p align="center">Workspace search for VS Code that finds what you meant: typos, umlauts and dotted keys included.</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=bjoern621.searchplusplus"><img src="https://vsmarketplacebadges.dev/version-short/bjoern621.searchplusplus.svg" alt="Marketplace version"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=bjoern621.searchplusplus"><img src="https://vsmarketplacebadges.dev/installs-short/bjoern621.searchplusplus.svg" alt="Installs"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license"></a>
</p>

![Typing gateway.image.tag into Search++ and opening the tag in deploy/web/values.yaml](docs/images/hero.gif)

## Typos match

`recieve` finds `receive`.
The context menu says why.

![The context menu of a receive match says "receive: 1 letter off from recieve."](docs/images/typo.png)

## Umlauts match both ways

`Größe` finds `Größere` and `maxUploadGroesse`.

![The query Größe finds Größe and Größere in a Markdown file and maxUploadGroesse in a TypeScript file](docs/images/umlaut.png)

## Keys by their path

`gateway.image.tag` finds the `tag` key in YAML, JSON and TOML files.

![The query gateway.image.tag finds tag in three values.yaml files, each row showing its key path](docs/images/keypath.png)

## Member chains

`config.server.port` finds `this.config.server.port` in TypeScript and JavaScript.

![The query config.server.port finds two lines in server.ts](docs/images/chain.png)

## Files and folders by name

`deploy/web` finds the folders `web` and `web-staging`.

<img src="docs/images/names.png" width="426" alt="The query deploy/web lists the folders web and web-staging under deploy">

## Cheat sheet

| Query            | Finds                                    |
| ---------------- | ---------------------------------------- |
| `grav`           | `Gravitee`, in any case and inside words |
| `"Größe"`        | `Größe` alone                            |
| `console.log(*)` | every call of `console.log`              |
| `**.enabled`     | every `enabled` key at any depth         |
| `/4\.\d+\.\d+/`  | version numbers, as a regex              |

The [reference](docs/reference.md) lists the whole query language, the settings and the Ctrl+Shift+F binding.

## Install and use

Install [Search++ from the Marketplace](https://marketplace.visualstudio.com/items?itemName=bjoern621.searchplusplus), then press Ctrl+Shift+F (Cmd+Shift+F on macOS).
Selected text in the editor goes into the query.
Replace stays with the built-in Search view.
Search++ needs VS Code 1.100 or later.

Other extensions add search engines through the [API](API.md).

[MIT](LICENSE)
