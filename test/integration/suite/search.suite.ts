import assert from "node:assert/strict";
import * as vscode from "vscode";
import type { KeyPathRoom, TestSnapshot } from "../../../src/messages";
import { type FileFields, NO_FILE_FIELDS } from "../../../src/search/globs";
import type { StructuralSearchApi } from "../../../src/search/registry";
import { type SearchScope, WORKING_TREE } from "../../../src/search/scope";

const EXTENSION_ID = "bjoern621.structural-search";
const EDITOR_WAIT_DURATION_MS = 5_000;
/** Longer than the delay before the hover card asks for its excerpt, with time left for the answer. */
const HOVER_WAIT_DURATION_MS = 1_000;
/** The default of `workbench.tree.indent`. */
const DEFAULT_TREE_INDENT_PX = 8;

/** Searches `scope` with `fields` in files to include and exclude. */
function search(query: string, fields: FileFields = NO_FILE_FIELDS, scope: SearchScope = WORKING_TREE): Thenable<TestSnapshot> {
  return vscode.commands.executeCommand<TestSnapshot>("structuralSearch.test.search", query, fields, scope);
}

/** Writes each commit row with `<sha>` in place of its short hash, since the length of a short hash depends on the repository. */
function withoutShas(rows: string[]): string[] {
  return rows.map((row) => row.replace(/^commit [0-9a-f]+ /, "commit <sha> "));
}

/** Searches with what the files to include and exclude fields hold. */
function searchKeepingFields(query: string): Thenable<TestSnapshot> {
  return vscode.commands.executeCommand<TestSnapshot>("structuralSearch.test.search", query);
}

/** Right-clicks the row `row` of `rows` and returns what the view shows. */
function openMenu(rows: string[], row: string): Thenable<TestSnapshot> {
  const index = rows.indexOf(row);
  assert.notEqual(index, -1, rows.join("\n"));
  return vscode.commands.executeCommand<TestSnapshot>("structuralSearch.test.openMenu", index);
}

function chooseMenuItem(label: string): Thenable<TestSnapshot> {
  return vscode.commands.executeCommand<TestSnapshot>("structuralSearch.test.chooseMenuItem", label);
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
    assert.equal(snapshot.summary, "3 results in 3 files | Working tree");
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

  it("searches once typing pauses, without Enter, and runs one search for keystrokes in quick succession", async () => {
    const { snapshot, searches } = await vscode.commands.executeCommand<{ snapshot: TestSnapshot; searches: number }>("structuralSearch.test.typeQuery", ["4.1", ".0"]);
    assert.equal(searches, 1);
    assert.equal(snapshot.summary, "3 results in 3 files | Working tree");
    assert.ok(snapshot.rows.includes("match 4:     tag: [4.1.0]"), snapshot.rows.join("\n"));
  });

  it("draws a divider above a code line that skips lines of its file and none above the next line or the first line of a file", async () => {
    const snapshot = await search("/^gateway|replicas|version/");
    const lines = snapshot.rows.flatMap((row, index) => (row.startsWith("match ") || row.startsWith("context ") ? [`${snapshot.gapsAbove[index] ? "—" : ""}${row.split(":")[0]}`] : []));
    assert.deepEqual(lines, ["context 1", "match 2", "match 1", "context 2", "—context 4", "match 5"]);
    assert.deepEqual(new Set(snapshot.rows.flatMap((row, index) => (row.startsWith("folder ") || row.startsWith("file ") ? [snapshot.gapsAbove[index]] : []))), new Set([false]));
  });

  it("runs a query between slashes as a regex through ripgrep", async () => {
    const snapshot = await search("/tag: \\d+\\.\\d+/");
    assert.equal(snapshot.hint, "Searching as a regex.");
    assert.equal(snapshot.summary, "1 result in 1 file | Working tree");
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
    assert.equal(snapshot.summary, " | Working tree");
    assert.deepEqual(snapshot.rows, []);
  });

  it("runs the query without slashes on a click on the hint of a regex that cannot compile", async () => {
    await search("/4.1.0 (/");
    const snapshot = await vscode.commands.executeCommand<TestSnapshot>("structuralSearch.test.clickHint");
    assert.equal(snapshot.hint, "");
    assert.equal(snapshot.summary, "No results. | Working tree");
  });

  it("closes a regex on a click on the hint after a leading slash", async () => {
    const before = await search("/tag: 4");
    assert.equal(before.hint, "End with a slash to search as a regex.");
    const snapshot = await vscode.commands.executeCommand<TestSnapshot>("structuralSearch.test.clickHint");
    assert.equal(snapshot.hint, "Searching as a regex.");
    assert.equal(snapshot.summary, "1 result in 1 file | Working tree");
  });

  it("finds a YAML key by its key path", async () => {
    const snapshot = await search("gateway.image.tag");
    assert.deepEqual(snapshot.rows.slice(0, 2), ["folder charts/apim", "file values.yaml"]);
    assert.ok(snapshot.rows.includes("match 4:     [tag]: 4.1.0"), snapshot.rows.join("\n"));
  });

  it("shows the key path after the line of a key that a key path query matched", async () => {
    const snapshot = await search("gateway.*");
    assert.deepEqual(shownKeyPaths(snapshot), {
      "match 2:   [image]:": "gateway.image",
      "match 5:   [replicas]: 2": "gateway.replicas",
    });
  });

  it("shows no key path after the line of a key that a single word matched", async () => {
    const snapshot = await search("gateway");
    assert.deepEqual(shownKeyPaths(snapshot), {
      "match 1: [gateway]:": "",
      "match 3:     repository: graviteeio/apim-[gateway]": "",
      "match 3: Move the [gateway] to 4.1.0 before the portal.": "",
    });
  });

  it("names the key path of a match before the file in its hover card", async () => {
    const snapshot = await search("gateway.image.tag");
    await vscode.commands.executeCommand("structuralSearch.test.hover", snapshot.rows.indexOf("match 4:     [tag]: 4.1.0"));
    assert.equal((await shownHover())[0], "gateway.image.tag · charts/apim/values.yaml");
  });

  it("cuts the folder of a long hover card header and leaves the key path whole", async () => {
    const snapshot = await search("service.loadBalancer");
    await vscode.commands.executeCommand("structuralSearch.test.hover", snapshot.rows.indexOf("match 2:   [loadBalancer]: sticky"));
    await shownHover();
    const box = (await vscode.commands.executeCommand<TestSnapshot>("structuralSearch.test.snapshot")).hoverGeometry;
    assert.ok(box, "no hover card");
    assert.ok(box.headerFolderCut > 0, JSON.stringify(box));
    assert.equal(box.headerKeyPathCut, 0);
  });

  it("cuts a key path too long for the side bar at key boundaries, in its row and in the hover card header", async () => {
    const keys = ["platform", "ingressController", "resourceLimits", "memory"];
    const snapshot = await search(keys.join("."));
    const index = snapshot.rows.findIndex((row) => row.startsWith("match 4:") && row.includes("[memory]"));
    assert.notEqual(index, -1, snapshot.rows.join("\n"));
    const drawn = snapshot.drawnKeyPaths[index] ?? "";
    assert.ok(keyBoundaryCuts(keys).includes(drawn), drawn);

    await vscode.commands.executeCommand("structuralSearch.test.hover", index);
    const header = (await shownHover())[0] ?? "";
    const box = (await vscode.commands.executeCommand<TestSnapshot>("structuralSearch.test.snapshot")).hoverGeometry;
    assert.ok(box, "no hover card");
    assert.ok(keyBoundaryCuts(keys).includes(header.split(" · ")[0] ?? ""), header);
    assert.ok(box.headerKeyPathCut <= 1, JSON.stringify(box));
  });

  it("cuts each key path to the longest cut that fits the room after its line text", async () => {
    const rooms: KeyPathRoom[] = [];
    for (const query of ["platform.ingressController.resourceLimits.memory", "**.tag", "**.replicas"]) {
      const snapshot = await search(query);
      rooms.push(...snapshot.keyPathRooms.filter((room): room is KeyPathRoom => room !== null));
    }
    assert.ok(rooms.some((room) => room.longer !== null), JSON.stringify(rooms));
    for (const room of rooms) {
      assert.ok(room.drawn <= room.room + 0.5, JSON.stringify(room));
      assert.ok(room.longer === null || room.longer > room.room, JSON.stringify(room));
    }
  });

  it("drops the results of an excluded folder at once and leaves the folder out of later searches", async () => {
    const before = await search("4.1.0");
    const snapshot = await excludeRow(before.rows, "folder docs");
    assert.equal(snapshot.exclude, "./docs/");
    assert.equal(snapshot.summary, "2 results in 2 files | Working tree");
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
    assert.equal(snapshot.summary, "2 results in 2 files | Working tree");
    assert.ok(!snapshot.rows.includes("file Chart.yaml"), snapshot.rows.join("\n"));
  });

  it("brings the results of an exclusion back at once when its entry leaves files to exclude", async () => {
    const before = await search("4.1.0");
    await excludeRow(before.rows, "folder docs");
    const snapshot = await typeFileFields(NO_FILE_FIELDS, false);
    assert.equal(snapshot.summary, "3 results in 3 files | Working tree");
  });

  it("repeats the search when an entry that it searched with leaves files to exclude", async () => {
    await search("4.1.0", { include: "", exclude: "./docs/" });
    const snapshot = await typeFileFields(NO_FILE_FIELDS, true);
    assert.equal(snapshot.summary, "3 results in 3 files | Working tree");
    assert.ok(snapshot.rows.includes("folder docs"), snapshot.rows.join("\n"));
  });

  it("searches the files that files to include names, minus those that files to exclude names", async () => {
    const yaml = await search("4.1.0", { include: "*.yaml", exclude: "Chart.yaml" });
    assert.deepEqual(
      yaml.rows.filter((row) => row.startsWith("file ")),
      ["file values.yaml"],
    );
    const regex = await search("/tag: \\d/", { include: "", exclude: "./charts/" });
    assert.equal(regex.summary, "No results. | Working tree");
  });

  it("says in the context menu why a close spelling matched and offers to find the word as written", async () => {
    const before = await search("Größe");
    const snapshot = await openMenu(before.rows, "match 5: A typo reads [Gröse].");
    assert.deepEqual(snapshot.menu, [
      "Gröse: close spelling of Größe, 1 edit away.",
      "-",
      `Find "Größe" as written`,
      "-",
      "Exclude sizing.md",
      "Exclude folder docs",
      "-",
      "Copy line",
    ]);

    const written = await vscode.commands.executeCommand<TestSnapshot>("structuralSearch.test.chooseMenuSearch", `Find "Größe" as written`);
    assert.equal(written.summary, "1 result in 1 file | Working tree");
    assert.ok(written.rows.includes("match 3: Set the [Größe] of each volume."), written.rows.join("\n"));
  });

  it("moves from the query into the results with Ctrl+Down, as the built-in Search view does", async () => {
    const snapshot = await search("replicas");
    // Files to include and files to exclude sit between the query and the results while they show.
    const fieldKeys = snapshot.fileFieldsOpen ? ["field:Ctrl+ArrowDown", "field:Ctrl+ArrowDown"] : [];
    const first = await vscode.commands.executeCommand<TestSnapshot>("structuralSearch.test.pressKeys", ["query:Ctrl+ArrowDown", ...fieldKeys]);
    assert.equal(first.focused, 0);
    const match = await vscode.commands.executeCommand<TestSnapshot>("structuralSearch.test.pressKeys", ["ArrowDown", "ArrowDown"]);
    assert.equal(snapshot.rows[match.focused], "match 5:   [replicas]: 2");
  });

  it("draws the match on the focused row in the highlight color of a focused list row", async () => {
    const snapshot = await search("replicas");
    const index = snapshot.rows.indexOf("match 5:   [replicas]: 2");
    const focused = await vscode.commands.executeCommand<TestSnapshot>("structuralSearch.test.pressKeys", downTo(snapshot.rows, index));
    assert.equal(focused.focused, index);
    assert.equal(focused.focusedMarkColor, focused.focusHighlightColor);
  });

  it("opens the context menu of the focused match with Shift+F10 and closes it with Escape", async () => {
    const before = await search("replicas");
    const index = before.rows.indexOf("match 5:   [replicas]: 2");
    const keys = downTo(before.rows, index);
    const open = await vscode.commands.executeCommand<TestSnapshot>("structuralSearch.test.pressKeys", [...keys, "Shift+F10"]);
    assert.deepEqual(open.menu, ["Exclude values.yaml", "Exclude folder charts/apim", "-", "Copy line"]);
    assert.equal(open.menuFocus, "Exclude values.yaml");
    const closed = await vscode.commands.executeCommand<TestSnapshot>("structuralSearch.test.pressKeys", ["Escape"]);
    assert.deepEqual(closed.menu, []);
    assert.equal(closed.focused, index);
  });

  it("copies the line and the key path of a match from the context menu", async () => {
    const before = await search("gateway.imag.tag");
    const menu = await openMenu(before.rows, "match 4:     [tag]: 4.1.0");
    assert.equal(menu.menu[0], "Key image: close spelling of imag, 1 edit away.");

    await vscode.env.clipboard.writeText("");
    await chooseMenuItem("Copy key path");
    assert.equal(await changedClipboard(""), "gateway.image.tag");

    await openMenu(before.rows, "match 4:     [tag]: 4.1.0");
    await vscode.env.clipboard.writeText("");
    await chooseMenuItem("Copy line");
    assert.equal(await changedClipboard(""), "    tag: 4.1.0");
  });

  it("highlights no item of a context menu opened with the pointer until Down moves to one", async () => {
    const before = await search("4.1.0");
    const open = await openMenu(before.rows, "match 4:     tag: [4.1.0]");
    assert.equal(open.menuFocus, "");
    const moved = await vscode.commands.executeCommand<TestSnapshot>("structuralSearch.test.pressKeys", ["ArrowDown"]);
    assert.equal(moved.menuFocus, "Exclude values.yaml");
    await vscode.commands.executeCommand("structuralSearch.test.pressKeys", ["Escape"]);
  });

  it("excludes the folder of a match from the context menu", async () => {
    const before = await search("4.1.0");
    await openMenu(before.rows, "match 3: Move the gateway to [4.1.0] before the portal.");
    const snapshot = await chooseMenuItem("Exclude folder docs");
    assert.equal(snapshot.exclude, "./docs/");
    assert.deepEqual(snapshot.menu, []);
    assert.equal(snapshot.summary, "2 results in 2 files | Working tree");
  });

  it("shows the lines around a match once the pointer rests on it", async () => {
    const snapshot = await search("4.1.0");
    const index = snapshot.rows.indexOf("match 4:     tag: [4.1.0]");
    assert.notEqual(index, -1, snapshot.rows.join("\n"));

    await vscode.commands.executeCommand("structuralSearch.test.hover", index);
    assert.deepEqual(await shownHover(), [
      "charts/apim/values.yaml",
      "context 1: gateway:",
      "context 2:   image:",
      "context 3:     repository: graviteeio/apim-gateway",
      "match 4:     tag: [4.1.0]",
      "context 5:   replicas: 2",
    ]);
  });

  it("keeps the hover card hidden while a context menu shows", async () => {
    const before = await search("4.1.0");
    const index = before.rows.indexOf("match 4:     tag: [4.1.0]");
    await openMenu(before.rows, "match 4:     tag: [4.1.0]");
    await vscode.commands.executeCommand("structuralSearch.test.hover", index);
    await new Promise((resolve) => setTimeout(resolve, HOVER_WAIT_DURATION_MS));
    const snapshot = await vscode.commands.executeCommand<TestSnapshot>("structuralSearch.test.snapshot");
    assert.deepEqual(snapshot.hover, []);
    assert.notDeepEqual(snapshot.menu, []);
    await vscode.commands.executeCommand("structuralSearch.test.pressKeys", ["Escape"]);
  });

  it("lays the hovered line of the card over its row, the lines around it above and below", async () => {
    const snapshot = await search("4.1.0");
    await vscode.commands.executeCommand("structuralSearch.test.hover", snapshot.rows.indexOf("match 4:     tag: [4.1.0]"));
    await shownHover();
    const box = (await vscode.commands.executeCommand<TestSnapshot>("structuralSearch.test.snapshot")).hoverGeometry;
    assert.ok(box, "no hover card");
    assert.ok(Math.abs(box.lineTop - box.rowTop) <= 1, JSON.stringify(box));
    assert.ok(Math.abs(box.lineTextLeft - box.rowTextLeft) <= 1, JSON.stringify(box));
    assert.ok(box.cardTop < box.rowTop, JSON.stringify(box));
  });

  it("drops the lines of the card that would leave the view, keeping the hovered line over its row", async () => {
    // The lines of docs/changelog.md make the results outgrow any view.
    // Walking down to a late entry scrolls its row to the bottom of the results.
    // The entry above it keeps room for the card padding, while the lines after it would leave the view.
    const snapshot = await search("Entry");
    const index = snapshot.rows.findIndex((row) => row.startsWith("match 38:"));
    assert.notEqual(index, -1, snapshot.rows.join("\n"));
    await vscode.commands.executeCommand("structuralSearch.test.pressKeys", downTo(snapshot.rows, index));
    await vscode.commands.executeCommand("structuralSearch.test.hover", index - 1);
    const hover = await shownHover();
    const box = (await vscode.commands.executeCommand<TestSnapshot>("structuralSearch.test.snapshot")).hoverGeometry;
    assert.ok(box, "no hover card");
    assert.ok(hover.includes(snapshot.rows[index - 1] as string), hover.join("\n"));
    assert.ok(!hover.some((line) => line.startsWith("match 42:")), `${hover.join("\n")}\n${JSON.stringify(box)}`);
    assert.ok(Math.abs(box.lineTop - box.rowTop) <= 1, JSON.stringify(box));
    assert.ok(box.cardTop >= 0 && box.cardBottom <= box.viewHeight, JSON.stringify(box));
  });

  it("ends the hover card where the scrollbar of the results starts, the hovered line still over its row", async () => {
    // The lines of docs/changelog.md make the results outgrow any view, so the results show a scrollbar.
    const snapshot = await search("Entry");
    await vscode.commands.executeCommand("structuralSearch.test.hover", snapshot.rows.findIndex((row) => row.startsWith("match 3:")));
    await shownHover();
    const box = (await vscode.commands.executeCommand<TestSnapshot>("structuralSearch.test.snapshot")).hoverGeometry;
    assert.ok(box, "no hover card");
    assert.ok(box.rowRight < box.viewWidth, JSON.stringify(box));
    assert.ok(Math.abs(box.cardRight - box.rowRight) <= 1, JSON.stringify(box));
    assert.ok(Math.abs(box.lineTop - box.rowTop) <= 1, JSON.stringify(box));
    assert.ok(Math.abs(box.lineTextLeft - box.rowTextLeft) <= 1, JSON.stringify(box));
  });

  it("draws code lines in the font size and the height of the file rows, whatever the editor font size", async () => {
    const editor = () => vscode.workspace.getConfiguration("editor");
    await editor().update("fontSize", 30, vscode.ConfigurationTarget.Global);
    try {
      const snapshot = await search("4.1.0");
      assert.ok(snapshot.fileRowMetrics && snapshot.codeLineMetrics, "no file row or code line");
      assert.deepEqual(snapshot.codeLineMetrics, snapshot.fileRowMetrics);
    } finally {
      await editor().update("fontSize", undefined, vscode.ConfigurationTarget.Global);
    }
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

  it("moves through the rows with Down, past the context lines, and opens the focused line with Enter", async () => {
    const snapshot = await search("replicas");
    const index = snapshot.rows.indexOf("match 5:   [replicas]: 2");
    assert.notEqual(index, -1, snapshot.rows.join("\n"));

    const file = await vscode.commands.executeCommand<TestSnapshot>("structuralSearch.test.pressKeys", ["ArrowDown", "ArrowDown"]);
    assert.equal(snapshot.rows[file.focused], "file values.yaml");
    const focused = await vscode.commands.executeCommand<TestSnapshot>("structuralSearch.test.pressKeys", ["ArrowDown", "ArrowDown", "ArrowUp", "ArrowDown"]);
    assert.equal(focused.focused, index);
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await vscode.commands.executeCommand("structuralSearch.test.pressKeys", ["Enter"]);
    assert.deepEqual(await settledSelection("charts/apim/values.yaml", [4, 2, 4, 10]), [4, 2, 4, 10]);
  });
});

describe("Structural Search scopes", () => {
  const history: SearchScope = { kind: "history" };
  const feature: SearchScope = { kind: "branch", branch: "feature" };

  after(async () => {
    await search("4.1.0", NO_FILE_FIELDS, WORKING_TREE);
  });

  it("offers the Git scopes in the scope menu and marks the current one", async () => {
    await search("4.1.0");
    const snapshot = await vscode.commands.executeCommand<TestSnapshot>("structuralSearch.test.openScopeMenu");
    assert.deepEqual(snapshot.menu, ["✓ Working tree", "-", "Files changed against main", "Another branch…", "Git history (Last 200 commits)"]);
    await vscode.commands.executeCommand("structuralSearch.test.pressKeys", ["Escape"]);
  });

  it("searches the files changed against the default branch, uncommitted changes included", async () => {
    const snapshot = await search("4.1.0", NO_FILE_FIELDS, { kind: "changed" });
    assert.equal(snapshot.summary, "2 results in 2 files | Changed against main");
    assert.deepEqual(
      snapshot.rows.filter((row) => row.startsWith("file ")),
      ["file values.yaml", "file upgrade.md"],
    );
  });

  it("searches another branch without a checkout and leaves out the excluded folders", async () => {
    const raised = await search("5.0.0", NO_FILE_FIELDS, feature);
    assert.equal(raised.summary, "1 result in 1 file | Branch feature");
    assert.deepEqual(raised.rows, ["folder charts/apim", "file values.yaml", "context 3:     repository: graviteeio/apim-gateway", "match 4:     tag: [5.0.0]", "context 5:   replicas: 2"]);

    const chart = await search("4.1.0", NO_FILE_FIELDS, feature);
    assert.deepEqual(chart.rows, ["folder charts/apim", "file Chart.yaml", "context 1: name: apim", "match 2: version: [4.1.0]"]);
  });

  it("picks the branch to search from a quick pick", async () => {
    await search("5.0.0");
    await vscode.commands.executeCommand("structuralSearch.test.openScopeMenu");
    const picked = vscode.commands.executeCommand<TestSnapshot>("structuralSearch.test.chooseMenuSearch", "Another branch…");
    const accepting = setInterval(() => void vscode.commands.executeCommand("workbench.action.acceptSelectedQuickOpenItem"), 200);
    try {
      const snapshot = await picked;
      assert.equal(snapshot.summary, "1 result in 1 file | Branch feature");
    } finally {
      clearInterval(accepting);
    }
  });

  it("groups the lines that recent commits added under their commits, newest first", async () => {
    const snapshot = await search("4.1.0", NO_FILE_FIELDS, history);
    assert.equal(snapshot.summary, "2 results in 2 commits | Git history");
    assert.deepEqual(withoutShas(snapshot.rows), [
      "commit <sha> Raise the gateway to 4.1.0 (Ada Lovelace, 2026-11-03)",
      "folder charts/apim",
      "file values.yaml",
      "context 3:     repository: graviteeio/apim-gateway",
      "match 4:     tag: [4.1.0]",
      "context 5:   replicas: 2",
      "commit <sha> Add the gateway chart (Ada Lovelace, 2026-11-01)",
      "folder charts/apim",
      "file Chart.yaml",
      "context 1: name: apim",
      "match 2: version: [4.1.0]",
    ]);
  });

  it("applies files to exclude to the Git history", async () => {
    const snapshot = await search("4.1.0", { include: "", exclude: "Chart.yaml" }, history);
    assert.equal(snapshot.summary, "1 result in 1 commit | Git history");
  });

  it("runs a regex and a key path through the Git history", async () => {
    const regex = await search("/tag: \\d+\\.\\d+/", NO_FILE_FIELDS, history);
    assert.deepEqual(
      regex.rows.filter((row) => row.startsWith("match ")),
      ["match 4:     [tag: 4.1].0", "match 4:     [tag: 4.0].0"],
    );
    const keyPath = await search("gateway.image.tag", NO_FILE_FIELDS, history);
    assert.deepEqual(
      keyPath.rows.filter((row) => row.startsWith("match ")),
      ["match 4:     [tag]: 4.1.0", "match 4:     [tag]: 4.0.0"],
    );
  });

  it("opens a match of the Git history in a read-only editor at the match", async () => {
    const snapshot = await search("4.0.0", NO_FILE_FIELDS, history);
    const index = snapshot.rows.indexOf("match 4:     tag: [4.0.0]");
    assert.notEqual(index, -1, snapshot.rows.join("\n"));

    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await vscode.commands.executeCommand("structuralSearch.test.clickRow", index);
    assert.deepEqual(await settledSelection("charts/apim/values.yaml", [3, 9, 3, 14]), [3, 9, 3, 14]);
    const editor = vscode.window.visibleTextEditors.find((candidate) => candidate.document.uri.path.endsWith("charts/apim/values.yaml"));
    assert.equal(editor?.document.uri.scheme, "structural-search-git");
    assert.equal(editor?.document.lineAt(3).text, "    tag: 4.0.0");
  });
});

describe("Structural Search tree", () => {
  const tree = () => vscode.workspace.getConfiguration("workbench.tree");
  const NESTED_FOLDER = "folder regions/europe-central/clusters/production-blue/tenants/payments/overrides";

  afterEach(async () => {
    await tree().update("indent", undefined, vscode.ConfigurationTarget.Global);
    await tree().update("renderIndentGuides", undefined, vscode.ConfigurationTarget.Global);
  });

  it("steps folders and files right by their depth and keeps every code line at the left edge", async () => {
    const snapshot = await search("/sticky|memory/");
    const treeRows = snapshot.rows.filter((row) => row.startsWith("folder ") || row.startsWith("file "));
    assert.deepEqual(treeRows, ["folder deploy", NESTED_FOLDER, "file values.yaml", "file limits.yaml"]);
    const left = (row: string) => snapshot.rowStartLefts[snapshot.rows.indexOf(row)] ?? Number.NaN;
    assert.equal(left(NESTED_FOLDER) - left("folder deploy"), DEFAULT_TREE_INDENT_PX);
    assert.equal(left("file values.yaml") - left(NESTED_FOLDER), DEFAULT_TREE_INDENT_PX);
    assert.ok(left("file limits.yaml") > left("folder deploy"), snapshot.rowStartLefts.join(", "));

    const shallow = await search("4.1.0");
    const codeLefts = [snapshot, shallow].flatMap((each) => each.rows.flatMap((row, index) => (isCodeRow(row) ? [each.rowStartLefts[index]] : [])));
    assert.equal(new Set(codeLefts).size, 1, codeLefts.join(", "));
  });

  it("joins each folder and file to its parent with a line and draws no line over code", async () => {
    const snapshot = await search("/sticky|memory/");
    const guides = (row: string) => snapshot.guides[snapshot.rows.indexOf(row)];
    assert.deepEqual(["folder deploy", NESTED_FOLDER, "file values.yaml", "file limits.yaml"].map(guides), ["", "├", "│└", "└"]);
    const codeGuides = snapshot.rows.flatMap((row, index) => (isCodeRow(row) ? [snapshot.guides[index]] : []));
    assert.deepEqual(new Set(codeGuides), new Set([""]));
  });

  it("follows the indent of the workbench trees and hides the lines once the settings turn them off", async () => {
    await search("/sticky|memory/");
    await tree().update("indent", 16, vscode.ConfigurationTarget.Global);
    await tree().update("renderIndentGuides", "none", vscode.ConfigurationTarget.Global);
    const snapshot = await settledSnapshot((current) => current.guides.every((guide) => guide === "" || guide === null));
    const left = (row: string) => snapshot.rowStartLefts[snapshot.rows.indexOf(row)] ?? Number.NaN;
    assert.equal(left(NESTED_FOLDER) - left("folder deploy"), 16);
    assert.deepEqual(new Set(snapshot.guides), new Set([""]));
  });
});

describe("Structural Search icons", () => {
  const workbench = () => vscode.workspace.getConfiguration("workbench");

  afterEach(async () => {
    await workbench().update("iconTheme", undefined, vscode.ConfigurationTarget.Global);
    await workbench().update("colorTheme", undefined, vscode.ConfigurationTarget.Global);
  });

  it("gives rows the icons of the built-in Seti theme, without folder icons, as Seti has none", async () => {
    const snapshot = await search("4.1.0");
    assert.deepEqual(rowIcons(snapshot), { "folder charts/apim": "", "file Chart.yaml": "_yml", "file values.yaml": "_yml", "folder docs": "", "file upgrade.md": "_markdown" });
  });

  it("starts the folder names where the file icons of the same depth start with Seti, as the built-in Search view does", async () => {
    const snapshot = await search("4.1.0");
    const folder = snapshot.rows.indexOf("folder charts/apim");
    const file = snapshot.rows.indexOf("file values.yaml");
    assert.equal(snapshot.iconLefts[folder], null);
    assert.equal((snapshot.labelLefts[folder] ?? 0) + DEFAULT_TREE_INDENT_PX, snapshot.iconLefts[file]);
  });

  it("switches to the light icons of Seti with a light color theme, without a new search", async () => {
    await search("4.1.0");
    await workbench().update("colorTheme", "Default Light Modern", vscode.ConfigurationTarget.Global);
    const icons = await changedIcons((current) => current["file values.yaml"] !== "_yml");
    assert.equal(icons["file values.yaml"], "_yml_light");
    assert.equal(icons["file upgrade.md"], "_markdown_light");
  });

  it("gives rows the SVG icons of the built-in Modern theme, expanded folders open", async () => {
    await search("4.1.0");
    await workbench().update("iconTheme", "vscode-modern-icons", vscode.ConfigurationTarget.Global);
    const icons = await changedIcons((current) => current["folder docs"] !== "");
    assert.deepEqual(icons, { "folder charts/apim": "_folderOpen", "file Chart.yaml": "_file", "file values.yaml": "_file", "folder docs": "_folderOpen", "file upgrade.md": "_markdown" });

    const collapsed = await vscode.commands.executeCommand<TestSnapshot>("structuralSearch.test.pressKeys", ["Home", "Enter"]);
    assert.equal(rowIcons(collapsed)["folder charts/apim"], "_folder");
  });

  it("shows no icons with the icon theme None", async () => {
    await search("4.1.0");
    await workbench().update("iconTheme", null, vscode.ConfigurationTarget.Global);
    const icons = await changedIcons((current) => current["file values.yaml"] === "");
    assert.deepEqual(new Set(Object.values(icons)), new Set([""]));

    const snapshot = await vscode.commands.executeCommand<TestSnapshot>("structuralSearch.test.snapshot");
    const folder = snapshot.rows.indexOf("folder charts/apim");
    const file = snapshot.rows.indexOf("file values.yaml");
    assert.equal((snapshot.labelLefts[folder] ?? 0) + DEFAULT_TREE_INDENT_PX, snapshot.labelLefts[file], "the folder name leaves the alignment of the file names");
  });
});

function isCodeRow(row: string): boolean {
  return row.startsWith("match ") || row.startsWith("context ");
}

/** Waits until the view passes `settled`, since a settings change reaches the view after the update resolves. Returns the last snapshot. */
async function settledSnapshot(settled: (snapshot: TestSnapshot) => boolean): Promise<TestSnapshot> {
  const deadline = Date.now() + EDITOR_WAIT_DURATION_MS;
  let snapshot = await vscode.commands.executeCommand<TestSnapshot>("structuralSearch.test.snapshot");
  while (Date.now() < deadline && !settled(snapshot)) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    snapshot = await vscode.commands.executeCommand<TestSnapshot>("structuralSearch.test.snapshot");
  }
  return snapshot;
}

/** Maps each folder and file row to its icon definition id. */
function rowIcons(snapshot: TestSnapshot): Record<string, string> {
  return Object.fromEntries(snapshot.rows.flatMap((row, index) => (row.startsWith("folder ") || row.startsWith("file ") ? [[row, snapshot.icons[index] ?? ""]] : [])));
}

/** Waits until the row icons pass `settled`, since a theme change reaches the view after the settings update resolves. Returns the last icons seen. */
async function changedIcons(settled: (icons: Record<string, string>) => boolean): Promise<Record<string, string>> {
  const deadline = Date.now() + EDITOR_WAIT_DURATION_MS;
  let icons: Record<string, string> = {};
  while (Date.now() < deadline) {
    icons = rowIcons(await vscode.commands.executeCommand<TestSnapshot>("structuralSearch.test.snapshot"));
    if (settled(icons)) return icons;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return icons;
}

/** The Down presses that move the focus from no row to the row at `index`. Down passes over context lines. */
function downTo(rows: string[], index: number): string[] {
  return rows.slice(0, index + 1).filter((row) => !row.startsWith("context ")).map(() => "ArrowDown");
}

/** Maps each match row to the key path that it shows, empty for a row without one. */
function shownKeyPaths(snapshot: TestSnapshot): Record<string, string> {
  return Object.fromEntries(snapshot.rows.flatMap((row, index) => (row.startsWith("match ") ? [[row, snapshot.keyPaths[index] ?? ""]] : [])));
}

/** Lists the ways to write `keys` cut at key boundaries: the first key, an ellipsis between thin spaces and the last keys, or an ellipsis and the last key. */
function keyBoundaryCuts(keys: readonly string[]): string[] {
  const cuts = keys.slice(2).map((_, index) => `${keys[0]}\u2009…\u2009${keys.slice(index + 2).join(".")}`);
  return [...cuts, `…${keys.at(-1)}`];
}

/** Waits for the hover card to show and returns what it holds. */
async function shownHover(): Promise<string[]> {
  const deadline = Date.now() + EDITOR_WAIT_DURATION_MS;
  let hover: string[] = [];
  while (Date.now() < deadline && hover.length === 0) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    hover = (await vscode.commands.executeCommand<TestSnapshot>("structuralSearch.test.snapshot")).hover;
  }
  return hover;
}

/** Waits for the clipboard to change from `before` and returns its text. */
async function changedClipboard(before: string): Promise<string> {
  const deadline = Date.now() + EDITOR_WAIT_DURATION_MS;
  let text = before;
  while (Date.now() < deadline && text === before) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    text = await vscode.env.clipboard.readText();
  }
  return text;
}

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
