import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";

export interface GitExit {
  /** Null when the signal stopped the process. */
  code: number | null;
  /** Empty when `onLine` took the output. */
  stdout: Buffer;
  stderr: string;
}

export interface GitOptions {
  cwd: string;
  signal?: AbortSignal;
  /** Takes the output line by line in place of `stdout`. A line ends at `\n` alone, as git counts the lines of a diff. */
  onLine?: (line: string) => void;
  /** Written to the standard input. Without it, the standard input closes empty. */
  stdin?: string;
}

/** Thrown for a git command that exits with a code other than 0. */
export class GitError extends Error {
  constructor(
    readonly args: readonly string[],
    readonly code: number | null,
    readonly stderr: string,
  ) {
    super(`git ${args.join(" ")} exited with ${code}: ${stderr.trim()}`);
  }
}

/**
 * The environment of every git process.
 * Optional locks stay off, so a search never blocks a commit that runs at the same time.
 * A prompt for credentials or an editor would hang a search that waits for git.
 */
export function gitEnvironment(): NodeJS.ProcessEnv {
  return { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", GIT_EDITOR: "true", LC_ALL: "C" };
}

/** Runs git and collects its output. Aborting `signal` kills the process and resolves with a null code. */
export function runGit(gitPath: string, args: readonly string[], options: GitOptions): Promise<GitExit> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      resolve({ code: null, stdout: Buffer.alloc(0), stderr: "" });
      return;
    }
    const child = spawn(gitPath, args, { cwd: options.cwd, env: gitEnvironment(), stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let stderr = "";
    const onAbort = () => child.kill();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    if (options.onLine) splitAtLineFeeds(child.stdout, options.onLine);
    else child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stdin.on("error", () => {});
    child.stdin.end(options.stdin);
    child.on("error", (error) => {
      options.signal?.removeEventListener("abort", onAbort);
      reject(error);
    });
    child.on("close", (code) => {
      options.signal?.removeEventListener("abort", onAbort);
      resolve({ code: options.signal?.aborted ? null : code, stdout: Buffer.concat(chunks), stderr });
    });
  });
}

/** Node's `readline` would end a line at a lone `\r` as well, which a line of a diff may hold. */
function splitAtLineFeeds(stream: Readable, onLine: (line: string) => void): void {
  const decoder = new StringDecoder("utf8");
  let rest = "";
  stream.on("data", (chunk: Buffer) => {
    const lines = (rest + decoder.write(chunk)).split("\n");
    rest = lines.pop() ?? "";
    for (const line of lines) onLine(line);
  });
  stream.on("end", () => {
    const last = rest + decoder.end();
    if (last !== "") onLine(last);
  });
}

/** Runs git and returns its output as text. Throws a `GitError` when git fails. */
export async function gitText(gitPath: string, args: readonly string[], options: GitOptions): Promise<string> {
  const exit = await runGit(gitPath, args, options);
  if (exit.code !== 0) throw new GitError(args, exit.code, exit.stderr);
  return exit.stdout.toString("utf8");
}
