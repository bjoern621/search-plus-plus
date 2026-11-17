import { describe, expect, it } from "vitest";
import { codeEngine, jsonEngine, tomlEngine, yamlEngine } from "../../src/structural";
import type { SearchEngine } from "../../src/search/types";
import { search } from "./search";

const ONE_MEGABYTE_CHARS = 1_000_000;
const MAX_SEARCH_DURATION_MS = 1000;

function repeatUntilMegabyte(entry: (i: number) => string): string {
  const parts: string[] = [];
  let length = 0;
  for (let i = 0; length < ONE_MEGABYTE_CHARS; i++) {
    const part = entry(i);
    parts.push(part);
    length += part.length;
  }
  return parts.join("");
}

const yamlText = repeatUntilMegabyte(
  (i) => `service${i}:\n  image:\n    repository: example/app\n    tag: "1.${i}"\n  resources:\n    limits:\n      memory: 512Mi\n  hosts:\n    - a${i}.example.com\n`,
);
const jsonText = `{${repeatUntilMegabyte((i) => `${i === 0 ? "" : ","}"service${i}": {"image": {"tag": "1.${i}"}, "resources": {"limits": {"memory": "512Mi"}}, "hosts": ["a${i}.example.com"]}\n`)}}`;
const tomlText = repeatUntilMegabyte((i) => `[service${i}.image]\ntag = "1.${i}"\n\n[service${i}.resources.limits]\nmemory = "512Mi"\nhosts = ["a${i}.example.com"]\n\n`);
const codeText = repeatUntilMegabyte((i) => `const port${i} = this.config.server${i % 7}.port + config?.limits["memory"];\n`);

function durationMs(engine: SearchEngine, relativePath: string, languageId: string, text: string, query: string): number {
  const started = performance.now();
  const matches = search(engine, relativePath, languageId, text, query);
  expect(matches.length).toBeGreaterThan(0);
  return performance.now() - started;
}

describe("1 MB files", () => {
  for (const query of ["**.limits.memory", "**.{requests,limits}.memory", "*.Imgae.tag"]) {
    it(`searches YAML for ${query} in under a second`, () => {
      expect(durationMs(yamlEngine, "values.yaml", "yaml", yamlText, query)).toBeLessThan(MAX_SEARCH_DURATION_MS);
    });

    it(`searches JSON for ${query} in under a second`, () => {
      expect(durationMs(jsonEngine, "data.json", "json", jsonText, query)).toBeLessThan(MAX_SEARCH_DURATION_MS);
    });

    it(`searches TOML for ${query} in under a second`, () => {
      expect(durationMs(tomlEngine, "data.toml", "toml", tomlText, query)).toBeLessThan(MAX_SEARCH_DURATION_MS);
    });
  }

  it("searches code for config.server.port in under a second", () => {
    expect(durationMs(codeEngine, "a.ts", "typescript", codeText, "config.server*.port")).toBeLessThan(MAX_SEARCH_DURATION_MS);
  });
});
