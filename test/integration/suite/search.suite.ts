import assert from "node:assert/strict";
import * as vscode from "vscode";
import type { TestSnapshot } from "../../../src/messages";
import { type FileFields, NO_FILE_FIELDS } from "../../../src/search/globs";
import type { StructuralSearchApi } from "../../../src/search/registry";

const EXTENSION_ID = "bjoern621.structural-search";
const EDITOR_WAIT_DURATION_MS = 5_000;

/** Searches with `fields` in files to include and exclude. */
function search(query: string, fields: FileFields = NO_FILE_FIELDS): Thenable<TestSnapshot> {
  return vscode.commands.executeCommand<TestSnapshot>("structuralSearch.test.search", query, fields);
}

/** Searches with what the files to include and exclude fields hold. */
function searchKeepingFields(query: string): Thenable<TestSnapshot> {
  return vscode.commands.executeCommand<TestSnapshot>("structuralSearch.test.search", query);
}

function typeFileFields(fields: FileFields, startsSearch: boolean): Thenable<TestSnapshot> {
  return vscode.commands.executeCommand<TestSnapshot>("structuralSearch.test.typeFileFields", fields, startsSearch);
}

function excludeRow(rows: string[], row: string): Thenable<TestSnapshot> {
  const index = rows.indexOf(row);
  assert.notEqual(index, -1, rows.join("\n"));
  return vscode.commands.executeCommand<TestSnapshot>("structuralSearch.test.excludeRow", index);
}

describe("Structural Search view", () => {
  let api: StructuralSearchApi;

  before(async () => {
    const extension = vscode.extensions.getExtension<StructuralSearchApi>(EXTENSION_ID);
    assert.ok(extension, `${EXTENSION_ID} must be loaded`);
    api = await extension.activate();
  });

  it("lists text matches under their folders, with context lines", async () => {
    const snapshot = await search("4.1.0");
    assert.equal(snapshot.hint, "");
    assert.equal(snapshot.summary, "3 results in 3 files | Working tree ▾");
    assert.deepEqual(snapshot.rows, [
      "folder charts/apim",
      "file Chart.yaml",
      "context 1: name: apim",
      "match 2: version: [4.1.0]",
      "file values.yaml",
      "context 3:     repository: graviteeio/apim-gateway",
      "match 4:     tag: [4.1.0]",
      "context 5:   replicas: 2",
      "folder docs",
      "file upgrade.md",
      "context 2: ",
      "match 3: Move the gateway to [4.1.0] before the portal.",
    ]);
  });

  it("runs a query between slashes as a regex through ripgrep", async () => {
    const snapshot = await search("/tag: \\d+\\.\\d+/");
    assert.equal(snapshot.hint, "Searching as a regex.");
    assert.equal(snapshot.summary, "1 result in 1 file | Working tree ▾");
    assert.deepEqual(snapshot.rows, [
      "folder charts/apim",
      "file values.yaml",
      "context 3:     repository: graviteeio/apim-gateway",
      "match 4:     [tag: 4.1].0",
      "context 5:   replicas: 2",
    ]);
  });

  it("shows the parser's message for a regex that cannot compile and searches nothing", async () => {
    const snapshot = await search("/tag: (/");
    assert.match(snapshot.hint, /^The regex cannot compile: .+\. Fix it or drop the slashes\.$/);
    assert.equal(snapshot.summary, "");
    assert.deepEqual(snapshot.rows, []);
  });

  it("runs the query without slashes on a click on the hint of a regex that cannot compile", async () => {
    await search("/4.1.0 (/");
    const snapshot = await vscode.commands.executeCommand<TestSnapshot>("structuralSearch.test.clickHint");
    assert.equal(snapshot.hint, "");
    assert.equal(snapshot.summary, "No results. | Working tree ▾");
  });

  it("closes a regex on a click on the hint after a leading slash", async () => {
    const before = await search("/tag: 4");
    assert.equal(before.hint, "End with a slash to search as a regex.");
    const snapshot = await vscode.commands.executeCommand<TestSnapshot>("structuralSearch.test.clickHint");
    assert.equal(snapshot.hint, "Searching as a regex.");
    assert.equal(snapshot.summary, "1 result in 1 file | Working tree ▾");
  });

  it("finds a YAML key by its key path", async () => {
    const snapshot = await search("gateway.image.tag");
    assert.deepEqual(snapshot.rows.slice(0, 2), ["folder charts/apim", "file values.yaml"]);
    assert.ok(snapshot.rows.includes("match 4:     [tag]: 4.1.0"), snapshot.rows.join("\n"));
  });

  it("drops the results of an excluded folder at once and leaves the folder out of later searches", async () => {
    const before = await search("4.1.0");
    const snapshot = await excludeRow(before.rows, "folder docs");
    assert.equal(snapshot.exclude, "./docs/");
    assert.equal(snapshot.summary, "2 results in 2 files | Working tree ▾");
    assert.ok(!snapshot.rows.includes("folder docs"), snapshot.rows.join("\n"));

    const later = await searchKeepingFields("gateway");
    assert.equal(later.exclude, "./docs/");
    assert.ok(later.rows.includes("file values.yaml"), later.rows.join("\n"));
    assert.ok(!later.rows.includes("folder docs"), later.rows.join("\n"));
  });

  it("drops the results of an excluded file at once", async () => {
    const before = await search("4.1.0");
    const snapshot = await excludeRow(before.rows, "file Chart.yaml");
    assert.equal(snapshot.exclude, "./charts/apim/Chart.yaml");
    assert.equal(snapshot.summary, "2 results in 2 files | Working tree ▾");
    assert.ok(!snapshot.rows.includes("file Chart.yaml"), snapshot.rows.join("\n"));
  });

  it("brings the results of an exclusion back at once when its entry leaves files to exclude", async () => {
    const before = await search("4.1.0");
    await excludeRow(before.rows, "folder docs");
    const snapshot = await typeFileFields(NO_FILE_FIELDS, false);
    assert.equal(snapshot.summary, "3 results in 3 files | Working tree ▾");
  });

  it("repeats the search when an entry that it searched with leaves files to exclude", async () => {
    await search("4.1.0", { include: "", exclude: "./docs/" });
    const snapshot = await typeFileFields(NO_FILE_FIELDS, true);
    assert.equal(snapshot.summary, "3 results in 3 files | Working tree ▾");
    assert.ok(snapshot.rows.includes("folder docs"), snapshot.rows.join("\n"));
  });

  it("searches the files that files to include names, minus those that files to exclude names", async () => {
    const yaml = await search("4.1.0", { include: "*.yaml", exclude: "Chart.yaml" });
    assert.deepEqual(
      yaml.rows.filter((row) => row.startsWith("file ")),
      ["file values.yaml"],
    );
    const regex = await search("/tag: \\d/", { include: "", exclude: "./charts/" });
    assert.equal(regex.summary, "No results. | Working tree ▾");
  });

  it("merges the matches of a registered engine into the lines of the others", async () => {
    const registration = api.registerEngine({
      id: "test.firstWord",
      accepts: (file) => file.relativePath === "docs/upgrade.md",
      search: () => [{ line: 2, ranges: [{ start: 0, end: 4 }], reasons: [] }],
    });
    try {
      const snapshot = await search("gateway");
      assert.deepEqual(snapshot.rows.slice(snapshot.rows.indexOf("folder docs")), [
        "folder docs",
        "file upgrade.md",
        "context 2: ",
        "match 3: [Move] the [gateway] to 4.1.0 before the portal.",
      ]);
    } finally {
      registration.dispose();
    }
  });

  it("opens the file of a clicked line with the match selected", async () => {
    const snapshot = await search("replicas");
    const index = snapshot.rows.indexOf("match 5:   [replicas]: 2");
    assert.notEqual(index, -1, snapshot.rows.join("\n"));

    await vscode.commands.executeCommand("structuralSearch.test.clickRow", index);
    assert.deepEqual(await settledSelection("charts/apim/values.yaml", [4, 2, 4, 10]), [4, 2, 4, 10]);
  });
});

/**
 * Returns the selection of the editor that shows `pathSuffix` as start line, start character, end line and end character.
 * An editor can show the file before it applies the selection, so this waits for `expected` and returns the last selection seen.
 */
async function settledSelection(pathSuffix: string, expected: number[]): Promise<number[] | undefined> {
  const deadline = Date.now() + EDITOR_WAIT_DURATION_MS;
  let selection: number[] | undefined;
  while (Date.now() < deadline) {
    const editor = vscode.window.visibleTextEditors.find((candidate) => candidate.document.uri.path.endsWith(pathSuffix));
    selection = editor && [editor.selection.start.line, editor.selection.start.character, editor.selection.end.line, editor.selection.end.character];
    if (selection?.join() === expected.join()) return selection;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return selection;
}
