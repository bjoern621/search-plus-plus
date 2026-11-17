import { describe, expect, it } from "vitest";
import { LanguageIndex, languageContributions } from "../../src/search/languages";

describe("LanguageIndex", () => {
  const index = new LanguageIndex(
    languageContributions([
      { contributes: { languages: [{ id: "yaml", extensions: [".yaml", ".yml"] }, { id: "dockerfile", filenames: ["Dockerfile"] }] } },
      { contributes: { languages: [{ id: "typescript", extensions: [".ts"] }, { id: "typescriptdecl", extensions: [".d.ts"] }, { extensions: [".x"] }] } },
      {},
    ]),
  );

  it("maps extensions case-insensitively", () => {
    expect(index.languageOf("values.YAML")).toBe("yaml");
  });

  it("maps exact file names before extensions", () => {
    expect(index.languageOf("Dockerfile")).toBe("dockerfile");
  });

  it("prefers the longer extension", () => {
    expect(index.languageOf("vscode.d.ts")).toBe("typescriptdecl");
    expect(index.languageOf("main.ts")).toBe("typescript");
  });

  it("falls back to plaintext", () => {
    expect(index.languageOf("notes.unknown")).toBe("plaintext");
  });
});
