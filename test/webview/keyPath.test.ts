import { describe, expect, it } from "vitest";
import { cutKeyPath, keyPathText, shownKeys } from "../../src/webview/keyPath";

describe("keyPathText", () => {
  it("joins keys with dots and quotes a key holding a dot or an operator", () => {
    expect(keyPathText(["metadata", "labels", "app.kubernetes.io/name"])).toBe('metadata.labels."app.kubernetes.io/name"');
    expect(keyPathText(["a", 'say "hi"'])).toBe('a."say \\"hi\\""');
    expect(keyPathText(["spec", "a b", "c*"])).toBe('spec."a b"."c*"');
  });
});

describe("cutKeyPath", () => {
  const keys = ["gateway", "deployment", "resources", "limits", "memory"];
  // One pixel per character, so each width counts characters.
  const measure = (text: string) => text.length;

  it("keeps a key path that fits whole", () => {
    expect(cutKeyPath(keys, 42, measure)).toBe("gateway.deployment.resources.limits.memory");
  });

  it("drops whole keys after the first one until the path fits, keeping the first and the last key", () => {
    expect(cutKeyPath(keys, 41, measure)).toBe("gateway.….resources.limits.memory");
    expect(cutKeyPath(keys, 31, measure)).toBe("gateway.….limits.memory");
    expect(cutKeyPath(keys, 22, measure)).toBe("gateway.….memory");
  });

  it("drops the first key once the first and the last key leave too little room", () => {
    expect(cutKeyPath(keys, 15, measure)).toBe("….memory");
    expect(cutKeyPath(keys, 8, measure)).toBe("….memory");
  });

  it("gives up on a width too narrow for the last key", () => {
    expect(cutKeyPath(keys, 7, measure)).toBeUndefined();
    expect(cutKeyPath(["memory"], 5, measure)).toBeUndefined();
  });

  it("cuts a quoted key as a whole", () => {
    expect(cutKeyPath(["metadata", "labels", "app.kubernetes.io/name"], 35, measure)).toBe('metadata.…."app.kubernetes.io/name"');
  });

  it("measures each candidate with the measure that it gets", () => {
    const wide = (text: string) => [...text].reduce((width, char) => width + (char === "…" ? 3 : 1), 0);
    expect(cutKeyPath(["a", "b", "c"], 5, wide)).toBe("a.b.c");
    expect(cutKeyPath(["a", "b", "c"], 4, wide)).toBeUndefined();
  });
});

describe("shownKeys", () => {
  const line = { line: 3, text: "    tag: 4.1.0", offset: 0, match: true, ranges: [{ start: 4, end: 7 }], keyPath: ["gateway", "image.registry", "tag"] };

  it("gives the keys of a key in a data file", () => {
    expect(shownKeys({ ...line, showKeyPath: true })).toEqual(["gateway", "image.registry", "tag"]);
  });

  it("shows nothing for a member chain in code or a line without key path", () => {
    expect(shownKeys(line)).toBeUndefined();
    expect(shownKeys({ ...line, keyPath: undefined, showKeyPath: true })).toBeUndefined();
  });
});
