import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
    type ColorKind,
    cssStringValue,
    fileIcons,
    IconResolver,
    iconTable,
    type IconThemeDocument
} from "../../src/icons/iconTheme"

function fixture(name: string): IconThemeDocument {
    return JSON.parse(
        readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8")
    ) as IconThemeDocument
}

const fontTheme = fixture("font-theme.json")
const svgTheme = fixture("svg-theme.json")

function fileIcon(
    document: IconThemeDocument,
    name: string,
    languageId = "plaintext",
    kind: ColorKind = "dark",
    parentFolder = "src"
): string | undefined {
    return new IconResolver(document, kind).fileIcon({ name, languageId, parentFolder })
}

function folderIcon(
    name: string,
    expanded: boolean,
    parentFolder = "workspace"
): string | undefined {
    return new IconResolver(svgTheme, "dark").folderIcon({
        name,
        parentFolder,
        expanded,
        root: false
    })
}

describe("IconResolver files", () => {
    it("picks a file name over every extension, ignoring case", () => {
        expect(fileIcon(fontTheme, "Dockerfile")).toBe("_docker")
        expect(fileIcon(svgTheme, "Chart.yaml", "yaml")).toBe("helm")
    })

    it("picks the longest compound extension first", () => {
        expect(fileIcon(fontTheme, "index.d.ts", "typescript")).toBe("_dts")
        expect(fileIcon(fontTheme, "index.ts", "typescript")).toBe("_ts")
        expect(fileIcon(svgTheme, "dev.values.yaml", "yaml")).toBe("helm-values")
    })

    it("leaves the whole file name out of the extensions, as VS Code does", () => {
        expect(fileIcon(svgTheme, "values.yaml", "yaml")).toBe("yaml")
    })

    it("falls back to the language id, with jsonc taking the icon of json", () => {
        expect(fileIcon(fontTheme, "values.yaml", "yaml")).toBe("_yml")
        expect(fileIcon(fontTheme, "tsconfig.json", "jsonc")).toBe("_json")
    })

    it("falls back to file for a name that no association matches", () => {
        expect(fileIcon(fontTheme, "notes.txt")).toBe("_default")
    })

    it("skips an association whose definition draws nothing", () => {
        expect(fileIcon(fontTheme, "README.md", "markdown")).toBe("_default")
    })

    it("takes a file name under its parent folder over the bare file name", () => {
        expect(fileIcon(svgTheme, "settings.json", "json", "dark", ".vscode")).toBe(
            "vscode-settings"
        )
        expect(fileIcon(svgTheme, "settings.json", "json", "dark", "config")).toBe("settings")
    })

    it("takes the light section in a light color theme and keeps the base where it says nothing", () => {
        expect(fileIcon(fontTheme, "values.yaml", "yaml", "light")).toBe("_yml_light")
        expect(fileIcon(fontTheme, "notes.txt", "plaintext", "light")).toBe("_default_light")
        expect(fileIcon(fontTheme, "index.ts", "typescript", "light")).toBe("_ts")
    })

    it("takes the high contrast section in both high contrast color themes", () => {
        expect(fileIcon(fontTheme, "index.ts", "typescript", "highContrast")).toBe("_ts_hc")
        expect(fileIcon(fontTheme, "index.ts", "typescript", "highContrastLight")).toBe("_ts_hc")
        expect(fileIcon(fontTheme, "values.yaml", "yaml", "highContrastLight")).toBe("_yml")
    })

    it("gives no icon with a theme that associates nothing", () => {
        expect(fileIcon({ iconDefinitions: {} }, "values.yaml", "yaml")).toBeUndefined()
    })
})

describe("IconResolver folders", () => {
    it("picks the expanded icon of a folder name for an expanded folder", () => {
        expect(folderIcon("charts", false)).toBe("folder-charts")
        expect(folderIcon("Charts", true)).toBe("folder-charts-open")
    })

    it("lets folderExpanded outrank a folder name without an expanded icon, as in VS Code", () => {
        expect(folderIcon("docs", false)).toBe("folder-docs")
        expect(folderIcon("docs", true)).toBe("folder-open")
    })

    it("matches a folder name under its parent folder", () => {
        expect(folderIcon("templates", false, "apim")).toBe("folder-templates")
        expect(folderIcon("templates", false, "web")).toBe("folder")
    })

    it("falls back to folder for a name whose definition is missing", () => {
        expect(folderIcon("broken", false)).toBe("folder")
    })

    it("takes the root folder associations for a workspace folder", () => {
        const resolver = new IconResolver(svgTheme, "dark")
        expect(
            resolver.folderIcon({ name: "infra", parentFolder: "", expanded: false, root: true })
        ).toBe("root-infra")
        expect(
            resolver.folderIcon({ name: "infra", parentFolder: "", expanded: true, root: true })
        ).toBe("root-open")
        expect(
            resolver.folderIcon({ name: "charts", parentFolder: "", expanded: false, root: true })
        ).toBe("root")
    })

    it("gives a workspace folder the folder icons of a theme without root folder icons", () => {
        const resolver = new IconResolver(
            { ...svgTheme, rootFolder: undefined, rootFolderExpanded: undefined },
            "dark"
        )
        expect(
            resolver.folderIcon({ name: "web", parentFolder: "", expanded: true, root: true })
        ).toBe("folder-open")
    })
})

describe("fileIcons", () => {
    const resolver = new IconResolver(svgTheme, "dark")

    it("gives each folder of the path its own icons", () => {
        expect(
            fileIcons(
                resolver,
                { name: "a.yaml", languageId: "yaml", folder: "charts/apim/templates", root: "" },
                "workspace"
            )
        ).toEqual({
            file: "yaml",
            folders: [
                { collapsed: "folder-charts", expanded: "folder-charts-open" },
                { collapsed: "folder", expanded: "folder-open" },
                { collapsed: "folder-templates", expanded: "folder-open" }
            ]
        })
    })

    it("gives the row of a workspace folder its root folder icons", () => {
        expect(
            fileIcons(
                resolver,
                { name: "Chart.yaml", languageId: "yaml", folder: "", root: "Infra" },
                "infra"
            )
        ).toEqual({ file: "helm", root: { collapsed: "root-infra", expanded: "root-open" } })
    })

    it("leaves out the folder icons of a file at the root of a single folder workspace", () => {
        expect(
            fileIcons(
                resolver,
                { name: "Chart.yaml", languageId: "yaml", folder: "", root: "" },
                "workspace"
            )
        ).toEqual({ file: "helm" })
    })
})

describe("iconTable", () => {
    const toUri = (path: string) => `https://theme/${path}`

    it("turns font characters into glyphs in the font and size that the theme sets", () => {
        const table = iconTable(fontTheme, toUri)
        expect(table.fonts).toEqual([
            {
                family: "glyphs",
                sources: [{ uri: "https://theme/./glyphs.woff", format: "woff" }],
                weight: "normal",
                style: "normal"
            },
            {
                family: "small",
                sources: [{ uri: "https://theme/./small.woff", format: "woff" }],
                weight: "normal",
                style: "normal"
            }
        ])
        expect(table.icons._yml).toEqual({
            kind: "glyph",
            character: "\uE0A7",
            family: "glyphs",
            size: "150%",
            color: "#a074c4"
        })
        expect(table.icons._dts).toEqual({
            kind: "glyph",
            character: "\uE0B1",
            family: "glyphs",
            size: "120%",
            color: "#519aba"
        })
        expect(table.icons._lock).toEqual({
            kind: "glyph",
            character: "\uE060",
            family: "small",
            size: "100%",
            color: undefined
        })
    })

    it("drops a font color that is no hex color and a definition that draws nothing", () => {
        const table = iconTable(fontTheme, toUri)
        expect(table.icons._docker).toMatchObject({ color: undefined })
        expect(table.icons._color_only).toBeUndefined()
    })

    it("turns icon paths into URIs relative to the theme document", () => {
        const table = iconTable(svgTheme, toUri)
        expect(table.fonts).toEqual([])
        expect(table.icons.helm).toEqual({
            kind: "image",
            uri: "https://theme/./icons/helm.svg",
            currentColor: false
        })
        expect(table.icons.json).toEqual({
            kind: "image",
            uri: "https://theme/../shared/json.svg",
            currentColor: false
        })
        expect(iconTable({ ...svgTheme, usesCurrentColor: true }, toUri).icons.helm).toMatchObject({
            currentColor: true
        })
    })
})

describe("cssStringValue", () => {
    it("reads CSS escapes as characters", () => {
        expect(cssStringValue("\\E001")).toBe("\uE001")
        expect(cssStringValue("\\f101 x")).toBe("\uF101x")
        expect(cssStringValue('\\"a')).toBe('"a')
        expect(cssStringValue("\\110000")).toBe("\uFFFD")
    })
})
