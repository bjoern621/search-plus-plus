import { describe, expect, it } from "vitest";
import { parseKeyPath, usesKeyPathSyntax } from "../../src/query";

function uses(raw: string): boolean {
  const parsed = parseKeyPath(raw);
  if ("error" in parsed) throw new Error(`Expected ${raw} to parse, got: ${parsed.error.message}`);
  return usesKeyPathSyntax(parsed.pattern);
}

describe("usesKeyPathSyntax", () => {
  it("leaves out a single plain word", () => {
    expect(uses("gateway")).toBe(false);
    expect(uses("Gravite")).toBe(false);
    expect(uses("app-name")).toBe(false);
  });

  it("counts two or more segments, an index among them", () => {
    expect(uses("gateway.image")).toBe(true);
    expect(uses("hosts.0")).toBe(true);
  });

  it("counts each operator of the key path language", () => {
    for (const raw of ["**", "gate*", "gatewa?", "[gG]ateway", "{gateway,portal}", '"gateway"', "gate\\.way"]) {
      expect(uses(raw), raw).toBe(true);
    }
  });
});
