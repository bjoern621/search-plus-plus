/** A `contributes.languages` entry of an extension manifest. */
export interface LanguageContribution {
  id: string;
  extensions?: string[];
  filenames?: string[];
}

/**
 * Maps a file name to a language id, as VS Code does from the language contributions of the installed extensions.
 * File name patterns and first-line patterns stay out, so a few files get `plaintext` where VS Code picks another language.
 */
export class LanguageIndex {
  /** Maps a lowercase file name to a language id. */
  private readonly byFilename = new Map<string, string>();
  /** Maps a lowercase extension with its dot, such as `.yaml`, to a language id. */
  private readonly byExtension = new Map<string, string>();

  constructor(contributions: readonly LanguageContribution[]) {
    for (const contribution of contributions) {
      for (const filename of contribution.filenames ?? []) this.byFilename.set(filename.toLowerCase(), contribution.id);
      for (const extension of contribution.extensions ?? []) this.byExtension.set(extension.toLowerCase(), contribution.id);
    }
  }

  /** Returns `plaintext` for a file name that no contribution claims. A longer extension wins: `.d.ts` over `.ts`. */
  languageOf(fileName: string): string {
    const name = fileName.toLowerCase();
    const byName = this.byFilename.get(name);
    if (byName) return byName;
    for (let dot = name.indexOf("."); dot >= 0; dot = name.indexOf(".", dot + 1)) {
      const language = this.byExtension.get(name.slice(dot));
      if (language) return language;
    }
    return "plaintext";
  }
}

/** Reads the language contributions out of extension manifests. Skips entries without an id. */
export function languageContributions(manifests: readonly unknown[]): LanguageContribution[] {
  return manifests.flatMap((manifest) => {
    const languages = (manifest as { contributes?: { languages?: unknown } } | undefined)?.contributes?.languages;
    if (!Array.isArray(languages)) return [];
    return languages.filter((language): language is LanguageContribution => typeof (language as LanguageContribution | undefined)?.id === "string");
  });
}
