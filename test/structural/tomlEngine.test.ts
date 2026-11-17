import { describe, expect, it } from "vitest";
import { parseQuery } from "../../src/query";
import { tomlEngine } from "../../src/structural";
import { fixture, found, highlighted, search } from "./search";

const cargo = fixture("Cargo.toml");

function inCargo(query: string): string[] {
  return found(search(tomlEngine, "Cargo.toml", "toml", cargo, query));
}

describe("tomlEngine", () => {
  it("finds keys below a table header", () => {
    expect(inCargo("package.version")).toEqual(["3: package.version"]);
    expect(inCargo("profile.release.lto")).toEqual(["17: profile.release.lto"]);
  });

  it("finds each part of a dotted key and of an inline table", () => {
    expect(inCargo("dependencies.tokio.version")).toEqual(["7: dependencies.tokio.version"]);
    expect(inCargo("dependencies.*.version")).toEqual(["6: dependencies.serde.version", "7: dependencies.tokio.version"]);
    expect(inCargo("dependencies.serde.features.0")).toEqual(["6: dependencies.serde.features.0"]);
  });

  it("numbers the tables of an array of tables from 0", () => {
    expect(inCargo("bin.1.name")).toEqual(["13: bin.1.name"]);
    expect(inCargo("bin.*.name")).toEqual(["10: bin.0.name", "13: bin.1.name"]);
    expect(inCargo("bin.1")).toEqual(["12: bin.1"]);
  });

  it("finds a quoted key holding a dot", () => {
    expect(inCargo('bin.1."weird.key"')).toEqual(["14: bin.1.weird.key"]);
  });

  it("matches a node on every line that writes its key", () => {
    const text = "[a.b]\nx = 1\n\n[a.c]\ny = 2\n";
    expect(found(search(tomlEngine, "pyproject.toml", "toml", text, "a"))).toEqual(["1: a", "4: a"]);
  });

  it("highlights the key part", () => {
    const matches = search(tomlEngine, "Cargo.toml", "toml", cargo, "dependencies.tokio.version");
    expect(highlighted(cargo, matches)).toEqual(["version"]);
  });

  it("skips the keys below a broken header and reads on from the next header", () => {
    const text = "[a\nb = 1\n[c]\nb = 2\n";
    expect(found(search(tomlEngine, "broken.toml", "toml", text, "**.b"))).toEqual(["4: c.b"]);
  });

  it("skips a broken line and keeps the keys around it", () => {
    const text = "x = 1\n= oops\ny = [1,\n  2]\nz = 3\n";
    expect(found(search(tomlEngine, "broken.toml", "toml", text, "*"))).toEqual(["1: x", "3: y", "5: z"]);
  });

  it("reads keys after a multi-line string", () => {
    const text = "a = \"\"\"\nb = 1\n\"\"\"\nc = 2\n";
    expect(found(search(tomlEngine, "strings.toml", "toml", text, "*"))).toEqual(["1: a", "4: c"]);
  });

  it("accepts TOML files by extension, since VS Code ships no TOML language", () => {
    const file = { uri: "file:///pyproject.toml", relativePath: "pyproject.toml", languageId: "plaintext" };
    expect(tomlEngine.accepts(file, parseQuery("tool.ruff"))).toBe(true);
  });
});
