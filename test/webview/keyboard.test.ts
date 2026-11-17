import { describe, expect, it } from "vitest";
import type { FileResult, ResultLine } from "../../src/messages";
import { rowCommand } from "../../src/webview/keyboard";
import type { Row } from "../../src/webview/tree";

const line: ResultLine = { line: 0, text: "a", offset: 0, match: true, ranges: [] };
const file = { uri: "file:///w/docs/a.md", name: "a.md" } as FileResult;

function rows(collapsed = false): Row[] {
  return [
    { kind: "folder", key: "0:docs", label: "docs", folder: "docs", collapsed: false },
    { kind: "file", key: file.uri, file, collapsed },
    { kind: "line", file, line },
    { kind: "line", file, line: { ...line, line: 1 } },
  ];
}

const press = (key: string, shiftKey = false) => ({ key, shiftKey });

describe("rowCommand", () => {
  it("moves the focus with Up, Down, Home and End and stops at both ends", () => {
    expect(rowCommand(rows(), -1, press("ArrowDown"))).toEqual({ kind: "focus", index: 0 });
    expect(rowCommand(rows(), 3, press("ArrowDown"))).toEqual({ kind: "focus", index: 3 });
    expect(rowCommand(rows(), 0, press("ArrowUp"))).toEqual({ kind: "focus", index: 0 });
    expect(rowCommand(rows(), 1, press("End"))).toEqual({ kind: "focus", index: 3 });
    expect(rowCommand(rows(), 3, press("Home"))).toEqual({ kind: "focus", index: 0 });
  });

  it("opens with Enter and keeps the focus with Space", () => {
    expect(rowCommand(rows(), 2, press("Enter"))).toEqual({ kind: "activate", preserveFocus: false });
    expect(rowCommand(rows(), 2, press(" "))).toEqual({ kind: "activate", preserveFocus: true });
  });

  it("collapses an expanded row with Left and moves from a line to its file, then to its folder", () => {
    expect(rowCommand(rows(), 1, press("ArrowLeft"))).toEqual({ kind: "toggle" });
    expect(rowCommand(rows(), 3, press("ArrowLeft"))).toEqual({ kind: "focus", index: 1 });
    expect(rowCommand(rows(true), 1, press("ArrowLeft"))).toEqual({ kind: "focus", index: 0 });
  });

  it("expands a collapsed row with Right and moves into an expanded one", () => {
    expect(rowCommand(rows(true), 1, press("ArrowRight"))).toEqual({ kind: "toggle" });
    expect(rowCommand(rows(), 1, press("ArrowRight"))).toEqual({ kind: "focus", index: 2 });
    expect(rowCommand(rows(), 2, press("ArrowRight"))).toBeUndefined();
  });

  it("opens the menu of a matched line with the context menu key or Shift+F10", () => {
    expect(rowCommand(rows(), 2, press("ContextMenu"))).toEqual({ kind: "menu" });
    expect(rowCommand(rows(), 2, press("F10", true))).toEqual({ kind: "menu" });
    expect(rowCommand(rows(), 2, press("F10"))).toBeUndefined();
    expect(rowCommand(rows(), 1, press("ContextMenu"))).toBeUndefined();
  });

  it("ignores every key without rows or without a focused row", () => {
    expect(rowCommand([], -1, press("ArrowDown"))).toBeUndefined();
    expect(rowCommand(rows(), -1, press("Enter"))).toBeUndefined();
  });

  it("moves from a file and from a folder to the commit row above in the Git history scope", () => {
    const commit = { sha: "a".repeat(40), shortSha: "aaaaaaa", author: "Ada", date: "2026-11-02T14:03:00+01:00", subject: "Raise the gateway", index: 0 };
    const history: Row[] = [{ kind: "commit", key: `commit:${commit.sha}`, commit, collapsed: false }, { kind: "file", key: "root", file, collapsed: false }, ...rows()];
    expect(rowCommand(history, 1, press("ArrowLeft"))).toEqual({ kind: "toggle" });
    expect(rowCommand(history.map((row) => (row.kind === "file" ? { ...row, collapsed: true } : row)), 1, press("ArrowLeft"))).toEqual({ kind: "focus", index: 0 });
    expect(rowCommand(history, 2, press("ArrowLeft"))).toEqual({ kind: "toggle" });
    expect(rowCommand(history.map((row) => (row.kind === "folder" ? { ...row, collapsed: true } : row)), 2, press("ArrowLeft"))).toEqual({ kind: "focus", index: 0 });
    expect(rowCommand(history, 0, press("ArrowLeft"))).toEqual({ kind: "toggle" });
  });
});
