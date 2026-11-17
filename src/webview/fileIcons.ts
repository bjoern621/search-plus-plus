import type { IconLook, IconTable } from "../messages";

/** Draws the icons of the file icon theme that the host sends. */
export class FileIconTheme {
  private icons: Record<string, IconLook> = {};
  private faces: FontFace[] = [];

  /** Replaces the theme and its fonts. `undefined` draws no icons. */
  set(table: IconTable | undefined): void {
    for (const face of this.faces) document.fonts.delete(face);
    this.faces = [];
    this.icons = table?.icons ?? {};
    for (const font of table?.fonts ?? []) {
      const source = font.sources.map((entry) => `url(${JSON.stringify(entry.uri)}) format(${JSON.stringify(entry.format)})`).join(", ");
      try {
        const face = new FontFace(font.family, source, { weight: font.weight, style: font.style, display: "block" });
        document.fonts.add(face);
        this.faces.push(face);
      } catch {
        // FontFace throws on a weight or style that CSS cannot read. Such a font stays unloaded.
      }
    }
  }

  /** Returns the icon slot for the definition `id`. An unknown or missing id leaves the slot empty, so the labels keep their alignment. */
  element(id: string | undefined): HTMLElement {
    const slot = document.createElement("span");
    slot.className = "file-icon";
    const look = id === undefined ? undefined : this.icons[id];
    if (!look) return slot;
    switch (look.kind) {
      case "image": {
        const image = `url(${JSON.stringify(look.uri)})`;
        if (look.currentColor) {
          slot.classList.add("masked");
          slot.style.maskImage = image;
          slot.style.webkitMaskImage = image;
        } else {
          slot.style.backgroundImage = image;
        }
        return slot;
      }
      case "glyph":
        slot.textContent = look.character;
        slot.style.fontFamily = JSON.stringify(look.family);
        slot.style.fontSize = look.size;
        if (look.color) slot.style.color = look.color;
        return slot;
    }
  }
}
