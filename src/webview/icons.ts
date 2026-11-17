export interface FileIcon {
  glyph: string;
  /** A CSS color, close to the Seti icon theme that VS Code ships. */
  color: string;
}

/** Maps a lowercase file extension to its icon. */
const ICONS: Record<string, FileIcon> = {
  yaml: { glyph: "Y", color: "#d78bd0" },
  yml: { glyph: "Y", color: "#d78bd0" },
  json: { glyph: "{}", color: "#cbcb41" },
  jsonc: { glyph: "{}", color: "#cbcb41" },
  toml: { glyph: "T", color: "#6d8086" },
  md: { glyph: "M", color: "#519aba" },
  ts: { glyph: "TS", color: "#519aba" },
  tsx: { glyph: "TS", color: "#519aba" },
  js: { glyph: "JS", color: "#cbcb41" },
  jsx: { glyph: "JS", color: "#cbcb41" },
  mjs: { glyph: "JS", color: "#cbcb41" },
  cjs: { glyph: "JS", color: "#cbcb41" },
  go: { glyph: "GO", color: "#519aba" },
  py: { glyph: "PY", color: "#519aba" },
  rs: { glyph: "RS", color: "#6d8086" },
  java: { glyph: "J", color: "#cc3e44" },
  html: { glyph: "<>", color: "#e37933" },
  css: { glyph: "#", color: "#519aba" },
  sh: { glyph: "$", color: "#8dc149" },
  nix: { glyph: "N", color: "#519aba" },
  tpl: { glyph: "{}", color: "#d78bd0" },
};

const GENERIC: FileIcon = { glyph: "≡", color: "var(--vscode-descriptionForeground)" };

export function fileIcon(name: string): FileIcon {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return GENERIC;
  return ICONS[name.slice(dot + 1).toLowerCase()] ?? GENERIC;
}
