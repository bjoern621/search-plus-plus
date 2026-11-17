import { describe, expect, it } from "vitest";
import { parseQuery } from "../../src/query";
import { codeEngine } from "../../src/structural";
import { memberChains } from "../../src/structural/memberChains";
import { fixture, found, highlighted, search } from "./search";

const server = fixture("server.ts.txt");

function chains(text: string): string[] {
  return memberChains(text).map((chain) => chain.map((key) => key.name).join("."));
}

describe("codeEngine: examples from DESIGN.md", () => {
  it("finds config.server.port in every spelling of the chain and leaves out strings, comments and regex literals", () => {
    const matches = search(codeEngine, "src/server.ts", "typescript", server, "config.server.port");
    expect(found(matches)).toEqual([
      "4: config.server.port",
      "5: config.server.port",
      "6: config.server.port",
      "7: config.server.port",
      "8: config.server.port",
      "9: config.server.port",
      "10: config.server.port",
    ]);
  });

  it("highlights the matched run of the chain on each of its lines", () => {
    const matches = search(codeEngine, "src/server.ts", "typescript", server, "config.server.port");
    expect(highlighted(server, matches)).toEqual([
      "config.server.port",
      "config?.server.port",
      'config["server"].port',
      "config",
      "server",
      "port",
      "config.server.port",
    ]);
  });

  it("finds a chain after a call", () => {
    expect(found(search(codeEngine, "src/server.ts", "typescript", server, "server.port"))).toContain("12: server.port");
  });

  it("finds close spellings and reports them", () => {
    const matches = search(codeEngine, "src/server.ts", "typescript", server, "confg.server.port");
    expect(matches[0]!.reasons).toEqual([{ kind: "fuzzy", query: "confg", found: "config", edits: 1 }]);
  });

  it("declines a query of one key, which the plain text engine covers", () => {
    const file = { uri: "file:///a.ts", relativePath: "a.ts", languageId: "typescript" };
    expect(codeEngine.accepts(file, parseQuery("port"))).toBe(false);
    expect(codeEngine.accepts(file, parseQuery("{server.port,x}"))).toBe(true);
    expect(codeEngine.accepts({ ...file, relativePath: "a.mjs", languageId: "plaintext" }, parseQuery("a.b"))).toBe(true);
    expect(codeEngine.accepts({ ...file, relativePath: "a.py", languageId: "python" }, parseQuery("a.b"))).toBe(false);
  });
});

describe("memberChains", () => {
  it("joins names with dots, optional chaining, non-null assertions and literal brackets", () => {
    expect(chains("a.b?.c!.d['e'][0]")).toEqual(["a.b.c.d.e.0"]);
  });

  it("ends a chain at a call or a computed access", () => {
    expect(chains("a.b(x).c.d; e[i].f.g")).toEqual(["a.b", "c.d", "f.g"]);
  });

  it("reads the code inside a template literal and skips its text", () => {
    expect(chains("`a.b ${x.y + `${p.q}`} c.d`")).toEqual(["x.y", "p.q"]);
  });

  it("tells a regex literal from a division", () => {
    expect(chains("const r = /a.b/; const n = x.y / z.w / 2;")).toEqual(["x.y", "z.w"]);
  });

  it("skips numbers and keeps an unclosed quote to its line", () => {
    expect(chains("const n = 1.5 + .5;\n<p>Don't</p>\na.b")).toEqual(["a.b"]);
  });
});
