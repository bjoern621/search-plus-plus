import type { FileIcons, FileResult, IconLook, IconTable } from "../messages";

/** The associations of a file icon theme, or of its `light` or `highContrast` section. Each value names an icon definition. */
export interface IconAssociations {
  file?: string;
  folder?: string;
  folderExpanded?: string;
  rootFolder?: string;
  rootFolderExpanded?: string;
  folderNames?: Record<string, string>;
  folderNamesExpanded?: Record<string, string>;
  rootFolderNames?: Record<string, string>;
  rootFolderNamesExpanded?: Record<string, string>;
  fileExtensions?: Record<string, string>;
  fileNames?: Record<string, string>;
  languageIds?: Record<string, string>;
}

export interface IconDefinition {
  iconPath?: string;
  fontCharacter?: string;
  fontColor?: string;
  fontSize?: string;
  fontId?: string;
}

export interface IconFont {
  id: string;
  src: { path: string; format: string }[];
  weight?: string;
  style?: string;
  size?: string;
}

/** A file icon theme document, as https://code.visualstudio.com/api/extension-guides/file-icon-theme describes it. Paths are relative to the document. */
export interface IconThemeDocument extends IconAssociations {
  iconDefinitions?: Record<string, IconDefinition>;
  fonts?: IconFont[];
  light?: IconAssociations;
  highContrast?: IconAssociations;
  /** SVG icons paint in the text color of the row. */
  usesCurrentColor?: boolean;
}

/** The kind of the active color theme, which picks the `light` or `highContrast` section. */
export type ColorKind = "light" | "dark" | "highContrast" | "highContrastLight";

export interface FileIconQuery {
  name: string;
  languageId: string;
  /** The name of the folder that holds the file. */
  parentFolder: string;
}

export interface FolderIconQuery {
  name: string;
  /** The name of the folder that holds the folder. Empty for a workspace folder. */
  parentFolder: string;
  expanded: boolean;
  /** A workspace folder takes the `rootFolder` associations. */
  root: boolean;
}

/** The icon size of a font that sets none, as in VS Code. */
const DEFAULT_FONT_SIZE = "150%";
const FONT_COLOR = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FONT_SIZE = /^[\w.%+-]+$/;

/** One section of the theme with lowercase keys, holding the associations whose definition exists. */
interface Section {
  /** Classes that the CSS qualifier of the section counts in VS Code: 1 for the base, 2 under `.vs` or `.hc-black`. */
  weight: number;
  file: string | undefined;
  folder: string | undefined;
  folderExpanded: string | undefined;
  rootFolder: string | undefined;
  rootFolderExpanded: string | undefined;
  folderNames: Map<string, string>;
  folderNamesExpanded: Map<string, string>;
  rootFolderNames: Map<string, string>;
  rootFolderNamesExpanded: Map<string, string>;
  fileExtensions: Map<string, string>;
  fileNames: Map<string, string>;
  languageIds: Map<string, string>;
}

/**
 * Picks icon definitions for files and folders as VS Code does.
 * VS Code turns each association into a CSS rule and lets the most specific rule win.
 * The resolver scores each association with the specificity of that rule:
 * a file name beats the longest extension, which beats shorter ones, then the language id, then `file`.
 * The `light` section applies to the light color theme, `highContrast` to both high contrast ones.
 * It wins over the base at equal specificity, as its rules come later in the style sheet.
 */
export class IconResolver {
  private readonly sections: Section[];

  constructor(document: IconThemeDocument, kind: ColorKind) {
    const usable = (id: unknown): id is string => typeof id === "string" && isUsable(document.iconDefinitions?.[id]);
    this.sections = [section(document, 1, usable)];
    const override = kind === "light" ? document.light : kind === "dark" ? undefined : document.highContrast;
    if (isObject(override)) this.sections.push(section(override, 2, usable));
  }

  /** Returns the definition id for a file, undefined if the theme gives files no icon. */
  fileIcon(query: FileIconQuery): string | undefined {
    const name = query.name.toLowerCase();
    const parent = query.parentFolder.toLowerCase();
    const segments = name.split(".");
    const best = new MostSpecific();
    for (const { weight, file, languageIds, fileExtensions, fileNames } of this.sections) {
      best.offer(file, weight + 1);
      best.offer(languageIds.get(query.languageId), weight + 2);
      for (let start = segments.length - 1; start >= 1; start--) {
        const extension = segments.slice(start).join(".");
        const extensionSegments = segments.length - start;
        best.offer(fileExtensions.get(extension), weight + extensionSegments + 2);
        best.offer(fileExtensions.get(`${parent}/${extension}`), weight + extensionSegments + 3);
      }
      best.offer(fileNames.get(name), weight + segments.length + 3);
      best.offer(fileNames.get(`${parent}/${name}`), weight + segments.length + 4);
    }
    return best.id;
  }

  /**
   * Returns the definition id for a folder, undefined if the theme gives folders no icon.
   * In VS Code, the rule for every expanded folder outranks the rule for a folder name, so `folderExpanded` beats `folderNames`.
   */
  folderIcon(query: FolderIconQuery): string | undefined {
    const name = query.name.toLowerCase();
    const parent = query.parentFolder.toLowerCase();
    const best = new MostSpecific();
    for (const section of this.sections) {
      const { weight } = section;
      if (query.root) {
        best.offer(section.rootFolder, weight + 1);
        best.offer(section.rootFolderNames.get(name), weight + 2);
        if (!query.expanded) continue;
        best.offer(section.rootFolderExpanded, weight + 5);
        best.offer(section.rootFolderNamesExpanded.get(name), weight + 6);
        continue;
      }
      best.offer(section.folder, weight + 1);
      best.offer(section.folderNames.get(name), weight + 2);
      best.offer(section.folderNames.get(`${parent}/${name}`), weight + 3);
      if (!query.expanded) continue;
      best.offer(section.folderExpanded, weight + 5);
      best.offer(section.folderNamesExpanded.get(name), weight + 6);
      best.offer(section.folderNamesExpanded.get(`${parent}/${name}`), weight + 7);
    }
    return best.id;
  }
}

/** Keeps the definition with the highest score. A tie goes to the later offer, as the later rule wins in CSS. */
class MostSpecific {
  id: string | undefined;
  private score = 0;

  offer(id: string | undefined, score: number): void {
    if (id === undefined || score < this.score) return;
    this.id = id;
    this.score = score;
  }
}

/**
 * Resolves the icons of a result file and of the folder row above it.
 * `rootFolderName` names the workspace folder of the file, as its path on disk spells it.
 * A file at the root of a single folder workspace has no folder row, so its folder icons stay missing.
 */
export function fileIcons(resolver: IconResolver, file: Pick<FileResult, "name" | "languageId" | "folder" | "root">, rootFolderName: string): FileIcons {
  const segments = file.folder === "" ? [] : file.folder.split("/");
  const icons: FileIcons = { file: resolver.fileIcon({ name: file.name, languageId: file.languageId, parentFolder: segments.at(-1) ?? rootFolderName }) };
  const folderName = segments.at(-1);
  if (folderName === undefined && file.root === "") return icons;
  // A compacted row such as charts/apim takes the icon of its last folder, as the explorer does.
  const folder = folderName === undefined ? { name: rootFolderName, parentFolder: "", root: true } : { name: folderName, parentFolder: segments.at(-2) ?? rootFolderName, root: false };
  icons.folder = resolver.folderIcon({ ...folder, expanded: false });
  icons.folderExpanded = resolver.folderIcon({ ...folder, expanded: true });
  return icons;
}

/**
 * Turns the icon definitions of a theme into what the view needs to draw them.
 * `toUri` maps a path relative to the theme document to a URI that the view can load.
 * Skips definitions that name neither an image nor a font character, and fonts without a source.
 */
export function iconTable(document: IconThemeDocument, toUri: (path: string) => string): IconTable {
  const fonts = Array.isArray(document.fonts) ? document.fonts.filter((font) => typeof font?.id === "string" && Array.isArray(font.src)) : [];
  const defaultFont = fonts[0];
  const defaultSize = validSize(defaultFont?.size) ?? DEFAULT_FONT_SIZE;
  const icons: Record<string, IconLook> = {};
  for (const [id, definition] of Object.entries(document.iconDefinitions ?? {})) {
    if (!isUsable(definition)) continue;
    if (typeof definition.iconPath === "string") {
      icons[id] = { kind: "image", uri: toUri(definition.iconPath), currentColor: document.usesCurrentColor === true };
      continue;
    }
    const font = typeof definition.fontId === "string" ? fonts.find((candidate) => candidate.id === definition.fontId) : defaultFont;
    if (!font || typeof definition.fontCharacter !== "string") continue;
    icons[id] = {
      kind: "glyph",
      character: cssStringValue(definition.fontCharacter),
      family: font.id,
      size: validSize(definition.fontSize) ?? validSize(font.size) ?? defaultSize,
      color: typeof definition.fontColor === "string" && FONT_COLOR.test(definition.fontColor) ? definition.fontColor : undefined,
    };
  }
  return {
    fonts: fonts.map((font) => ({
      family: font.id,
      sources: font.src.filter((source) => typeof source?.path === "string").map((source) => ({ uri: toUri(source.path), format: String(source.format) })),
      weight: typeof font.weight === "string" ? font.weight : "normal",
      style: typeof font.style === "string" ? font.style : "normal",
    })),
    icons,
  };
}

function section(associations: IconAssociations, weight: number, usable: (id: unknown) => id is string): Section {
  const id = (value: unknown): string | undefined => (usable(value) ? value : undefined);
  const lookup = (map: unknown, lowercase = true): Map<string, string> => {
    const result = new Map<string, string>();
    if (!isObject(map)) return result;
    for (const [key, value] of Object.entries(map)) if (usable(value)) result.set(lowercase ? key.toLowerCase() : key, value);
    return result;
  };
  const languageIds = lookup(associations.languageIds, false);
  const json = languageIds.get("json");
  if (json !== undefined && !languageIds.has("jsonc")) languageIds.set("jsonc", json);
  return {
    weight,
    file: id(associations.file),
    folder: id(associations.folder),
    folderExpanded: id(associations.folderExpanded),
    rootFolder: id(associations.rootFolder ?? associations.folder),
    rootFolderExpanded: id(associations.rootFolderExpanded ?? associations.folderExpanded),
    folderNames: lookup(associations.folderNames),
    folderNamesExpanded: lookup(associations.folderNamesExpanded),
    rootFolderNames: lookup(associations.rootFolderNames),
    rootFolderNamesExpanded: lookup(associations.rootFolderNamesExpanded),
    fileExtensions: lookup(associations.fileExtensions),
    fileNames: lookup(associations.fileNames),
    languageIds,
  };
}

/** A definition draws something with an image or a font character. VS Code emits no rule for any other, so a less specific association applies. */
function isUsable(definition: IconDefinition | undefined): boolean {
  return isObject(definition) && (typeof definition.iconPath === "string" || typeof definition.fontCharacter === "string");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validSize(size: unknown): string | undefined {
  return typeof size === "string" && FONT_SIZE.test(size) ? size : undefined;
}

/** Reads `\E001` as the character U+E001, since a theme writes its font characters as the content of a CSS string. */
export function cssStringValue(value: string): string {
  return value.replace(/\\([0-9a-f]{1,6}) ?|\\(.)/gi, (_, hex: string | undefined, escaped: string | undefined) => (hex === undefined ? (escaped ?? "") : codePoint(Number.parseInt(hex, 16))));
}

/** CSS reads an escape past the last code point as U+FFFD. */
function codePoint(value: number): string {
  return String.fromCodePoint(value > 0x10ffff ? 0xfffd : value);
}
