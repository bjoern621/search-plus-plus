import { describe, expect, it } from "vitest";
import { keyPathText, shownKeyPath } from "../../src/webview/keyPath";

describe("keyPathText", () => {
  it("joins keys with dots and quotes a key holding a dot or an operator", () => {
    expect(keyPathText(["metadata", "labels", "app.kubernetes.io/name"])).toBe('metadata.labels."app.kubernetes.io/name"');
    expect(keyPathText(["a", 'say "hi"'])).toBe('a."say \\"hi\\""');
    expect(keyPathText(["spec", "a b", "c*"])).toBe('spec."a b"."c*"');
  });
});

describe("shownKeyPath", () => {
  const line = { line: 3, text: "    tag: 4.1.0", offset: 0, match: true, ranges: [{ start: 4, end: 7 }], keyPath: ["gateway", "image.registry", "tag"] };

  it("writes the key path of a key in a data file as a query", () => {
    expect(shownKeyPath({ ...line, showKeyPath: true })).toBe('gateway."image.registry".tag');
  });

  it("shows nothing for a member chain in code or a line without key path", () => {
    expect(shownKeyPath(line)).toBeUndefined();
    expect(shownKeyPath({ ...line, keyPath: undefined, showKeyPath: true })).toBeUndefined();
  });
});
