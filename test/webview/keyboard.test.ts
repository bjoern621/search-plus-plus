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

  it("ignores every key without rows or without a focused row", () => {
    expect(rowCommand([], -1, press("ArrowDown"))).toBeUndefined();
    expect(rowCommand(rows(), -1, press("Enter"))).toBeUndefined();
  });
});
