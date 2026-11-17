import { describe, expect, it } from "vitest";
import type { FileResult, ResultLine } from "../../src/messages";
import { mergeExcerpt } from "../../src/webview/hoverCard";

function plain(line: number, text: string): ResultLine {
  return { line, text, offset: 0, match: false, ranges: [] };
}

describe("mergeExcerpt", () => {
  it("keeps the marks of the matches that the results hold", () => {
    const match: ResultLine = { line: 2, text: "  tag: 4.1.0", offset: 0, match: true, ranges: [{ start: 2, end: 5 }] };
    const file = { blocks: [[plain(1, "  image:"), match]] } as unknown as FileResult;
    const excerpt = [plain(0, "gateway:"), plain(1, "  image:"), plain(2, "  tag: 4.1.0"), plain(3, "  replicas: 2")];
    expect(mergeExcerpt(excerpt, file)).toEqual([excerpt[0], excerpt[1], match, excerpt[3]]);
  });
});
