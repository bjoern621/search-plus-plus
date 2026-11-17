import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { assert } from "../search/assert";
import { gitEnvironment } from "./cli";
import { type CatFileObject, CatFileParser } from "./parse";

/**
 * Reads objects from one repository through one `git cat-file --batch` process.
 * One `read` may run at a time. `close` ends the process.
 */
export class GitBlobReader {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly parser = new CatFileParser();
  private waiting: { names: number; objects: CatFileObject[]; resolve: (objects: CatFileObject[]) => void; reject: (error: Error) => void } | undefined;
  private failure: Error | undefined;

  constructor(gitPath: string, cwd: string) {
    this.child = spawn(gitPath, ["cat-file", "--batch"], { cwd, env: gitEnvironment() });
    this.child.stdout.on("data", (chunk: Buffer) => this.receive(chunk));
    this.child.stdin.on("error", () => {});
    this.child.on("error", (error) => this.fail(error));
    this.child.on("close", (code) => this.fail(new Error(`git cat-file exited with ${code}`)));
  }

  /** Reads the objects that `names` name, such as `HEAD:charts/values.yaml` or a blob hash, in the same order. */
  read(names: readonly string[]): Promise<CatFileObject[]> {
    assert(this.waiting === undefined, "one read must end before the next starts");
    if (this.failure) return Promise.reject(this.failure);
    if (names.length === 0) return Promise.resolve([]);
    assert(
      names.every((name) => !name.includes("\n")),
      "an object name must not hold a line feed",
    );
    return new Promise((resolve, reject) => {
      this.waiting = { names: names.length, objects: [], resolve, reject };
      this.child.stdin.write(names.map((name) => `${name}\n`).join(""));
    });
  }

  close(): void {
    this.child.stdin.end();
    this.child.kill();
  }

  private receive(chunk: Buffer): void {
    const objects = this.parser.push(chunk);
    const waiting = this.waiting;
    if (!waiting) return;
    waiting.objects.push(...objects);
    if (waiting.objects.length < waiting.names) return;
    this.waiting = undefined;
    waiting.resolve(waiting.objects);
  }

  private fail(error: Error): void {
    this.failure ??= error;
    const waiting = this.waiting;
    this.waiting = undefined;
    waiting?.reject(this.failure);
  }
}
