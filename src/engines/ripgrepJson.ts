import type { Range } from "../search/types";

export type RipgrepEvent =
  | { kind: "match"; path: string; line: number; ranges: Range[] }
  | { kind: "end"; path: string }
  | { kind: "other" };

interface RipgrepData {
  text?: string;
  bytes?: string;
}

interface RipgrepMessage {
  type: string;
  data?: {
    path?: RipgrepData;
    lines?: RipgrepData;
    line_number?: number;
    submatches?: { start: number; end: number }[];
  };
}

/**
 * Reads one line of `rg --json` output.
 * Lines and paths that are not valid UTF-8 reach ripgrep's output in base64 and stay out of the results.
 * `line` counts from 0. Ranges count UTF-16 code units, converted from ripgrep's byte offsets.
 */
export function parseRipgrepEvent(jsonLine: string): RipgrepEvent {
  const message = JSON.parse(jsonLine) as RipgrepMessage;
  const path = message.data?.path?.text;
  if (path === undefined) return { kind: "other" };
  if (message.type === "end") return { kind: "end", path };
  if (message.type !== "match") return { kind: "other" };
  const text = message.data?.lines?.text;
  const lineNumber = message.data?.line_number;
  if (text === undefined || lineNumber === undefined) return { kind: "other" };
  const bytes = Buffer.from(text, "utf8");
  const ranges = (message.data?.submatches ?? []).map((submatch) => ({
    start: utf16Length(bytes, submatch.start),
    end: utf16Length(bytes, submatch.end),
  }));
  return { kind: "match", path, line: lineNumber - 1, ranges };
}

function utf16Length(bytes: Buffer, byteOffset: number): number {
  return bytes.subarray(0, byteOffset).toString("utf8").length;
}

/**
 * Pulls the parser's message out of ripgrep's error output, such as "unclosed group".
 * Falls back to the last line of the output.
 */
export function regexErrorMessage(stderr: string): string {
  const lines = stderr.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "");
  const error = lines.find((line) => line.startsWith("error:"));
  const message = error ? error.slice("error:".length) : (lines.at(-1) ?? "").replace(/^rg:\s*/, "");
  return message.trim().replace(/\.$/, "");
}
