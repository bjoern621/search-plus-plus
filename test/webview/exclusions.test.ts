import { describe, expect, it } from "vitest";
import { appendEntry, fileEntry, folderEntry, onlyAdded } from "../../src/webview/exclusions";

describe("exclude entries", () => {
  it("names a file and a folder from the workspace folder", () => {
    expect(fileEntry({ folder: "charts/apim", name: "values.yaml" })).toBe("./charts/apim/values.yaml");
    expect(fileEntry({ folder: "", name: "README.md" })).toBe("./README.md");
    expect(folderEntry("charts/apim")).toBe("./charts/apim/");
  });

  it("refuses an entry for the workspace folder itself", () => {
    expect(() => folderEntry("")).toThrow("the workspace folder itself takes no exclude entry");
  });

  it("appends an entry once", () => {
    expect(appendEntry("", "./docs/")).toBe("./docs/");
    expect(appendEntry("*.lock", "./docs/")).toBe("*.lock, ./docs/");
    expect(appendEntry("*.lock, ./docs/", "./docs/")).toBe("*.lock, ./docs/");
  });

  it("tells an added entry from a removed one", () => {
    expect(onlyAdded("./docs/", "./docs/, *.lock")).toBe(true);
    expect(onlyAdded("./docs/, *.lock", "*.lock")).toBe(false);
  });
});
