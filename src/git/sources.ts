import type { CommitInfo } from "../messages";
import { BINARY_SNIFF_LENGTH_BYTES, FILE_SIZE_LIMIT_BYTES, HISTORY_COMMIT_LIMIT, REVISION_BATCH_FILE_COUNT, REVISION_BATCH_SIZE_BYTES } from "../search/config";
import type { PathTest, RevisionFile, RevisionSource } from "../search/revisions";
import type { SearchRoot } from "../search/workspaceEngine";
import { GitBlobReader } from "./blobReader";
import { GitError, gitText, runGit } from "./cli";
import { type CatFileObject, HistoryParser, historyLogArgs, type ParsedCommit, parseLsTree } from "./parse";
import type { Repository } from "./repository";
import { revisionUri } from "./revisionDocuments";

/** A workspace folder on disk and the repository that holds it. */
export interface RootRepository {
  root: SearchRoot;
  /** The path of the workspace folder on disk. */
  cwd: string;
  repository: Repository;
}

/** A file that a source has listed and still has to read. */
interface ListedFile {
  relativePath: string;
  /** The name that `git cat-file` reads the file by, such as a blob hash. */
  object: string;
  /** Undefined when the listing gave no size. */
  sizeBytes: number | undefined;
  ref: string;
  matchableLines?: ReadonlySet<number>;
  commit?: CommitInfo;
}

/** Symbolic links and submodules hold no text of their own. */
const SKIPPED_MODES = new Set(["120000", "160000"]);

const decoder = new TextDecoder("utf-8");

/** Lists every tracked file of a branch and reads it from Git without a checkout. */
export class BranchSource implements RevisionSource {
  constructor(
    private readonly gitPath: string,
    private readonly roots: readonly RootRepository[],
    private readonly branch: string,
    private readonly log: (message: string) => void,
  ) {}

  async *batches(accepts: PathTest, signal: AbortSignal): AsyncIterable<RevisionFile[]> {
    for (const place of this.roots) {
      if (signal.aborted) return;
      const listed = await this.list(place, accepts, signal);
      yield* readInBatches(this.gitPath, place, listed, signal);
    }
  }

  /** Lists the files of the branch below the workspace folder, with paths relative to it. */
  private async list(place: RootRepository, accepts: PathTest, signal: AbortSignal): Promise<ListedFile[]> {
    let output: string;
    try {
      output = await gitText(this.gitPath, ["ls-tree", "-r", "-l", "-z", "--end-of-options", this.branch], { cwd: place.cwd, signal });
    } catch (error) {
      if (!signal.aborted) this.log(`Could not list branch ${this.branch} in ${place.cwd}: ${String(error)}`);
      return [];
    }
    return parseLsTree(output)
      .filter((entry) => entry.type === "blob" && !SKIPPED_MODES.has(entry.mode) && (entry.sizeBytes ?? 0) <= FILE_SIZE_LIMIT_BYTES && accepts(place.root, entry.path))
      .map((entry) => ({ relativePath: entry.path, object: entry.object, sizeBytes: entry.sizeBytes, ref: this.branch }));
  }
}

/** Reads the lines that the latest `HISTORY_COMMIT_LIMIT` commits on HEAD added or changed. */
export class HistorySource implements RevisionSource {
  constructor(
    private readonly gitPath: string,
    private readonly roots: readonly RootRepository[],
    private readonly log: (message: string) => void,
  ) {}

  async *batches(accepts: PathTest, signal: AbortSignal): AsyncIterable<RevisionFile[]> {
    for (const place of this.roots) {
      if (signal.aborted) return;
      const commits = await this.commits(place, signal);
      const listed = commits.flatMap((commit) =>
        commit.files
          .filter((file) => accepts(place.root, file.path))
          .map((file) => ({
            relativePath: file.path,
            object: `${commit.commit.sha}:${place.repository.prefix}${file.path}`,
            sizeBytes: undefined,
            ref: commit.commit.sha,
            matchableLines: new Set(file.addedLines),
            commit: commit.commit,
          })),
      );
      yield* readInBatches(this.gitPath, place, listed, signal);
    }
  }

  /** Runs `git log --patch` below the workspace folder and keeps the added lines of each file. */
  private async commits(place: RootRepository, signal: AbortSignal): Promise<ParsedCommit[]> {
    const commits: ParsedCommit[] = [];
    const parser = new HistoryParser((commit) => commits.push(commit));
    const args = historyLogArgs(HISTORY_COMMIT_LIMIT);
    const exit = await runGit(this.gitPath, args, { cwd: place.cwd, signal, onLine: (line) => parser.line(line) }).catch((error: unknown) => {
      this.log(`Could not read the history of ${place.cwd}: ${String(error)}`);
      return undefined;
    });
    if (!exit || signal.aborted) return [];
    // A repository without commits has no HEAD to read.
    if (exit.code !== 0) {
      this.log(String(new GitError(args, exit.code, exit.stderr)));
      return [];
    }
    parser.end();
    return commits;
  }
}

/** Reads the listed files through one `git cat-file` process and yields them in batches. Leaves out binary files and files over the size limit. */
async function* readInBatches(gitPath: string, place: RootRepository, listed: readonly ListedFile[], signal: AbortSignal): AsyncIterable<RevisionFile[]> {
  if (listed.length === 0 || signal.aborted) return;
  const reader = new GitBlobReader(gitPath, place.repository.top);
  try {
    for (const batch of batchesOf(listed)) {
      if (signal.aborted) return;
      const objects = await reader.read(batch.map((file) => file.object));
      const files = batch.flatMap((file, index) => revisionFile(place, file, objects[index]));
      if (files.length > 0) yield files;
    }
  } finally {
    reader.close();
  }
}

/** Splits files into batches of at most `REVISION_BATCH_FILE_COUNT` files and, where the sizes are known, `REVISION_BATCH_SIZE_BYTES`. */
function* batchesOf(files: readonly ListedFile[]): Iterable<ListedFile[]> {
  let batch: ListedFile[] = [];
  let sizeBytes = 0;
  for (const file of files) {
    const fileBytes = file.sizeBytes ?? 0;
    if (batch.length >= REVISION_BATCH_FILE_COUNT || (batch.length > 0 && sizeBytes + fileBytes > REVISION_BATCH_SIZE_BYTES)) {
      yield batch;
      batch = [];
      sizeBytes = 0;
    }
    batch.push(file);
    sizeBytes += fileBytes;
  }
  if (batch.length > 0) yield batch;
}

function revisionFile(place: RootRepository, file: ListedFile, object: CatFileObject | undefined): RevisionFile[] {
  if (object?.kind !== "found" || object.type !== "blob") return [];
  if (object.bytes.length > FILE_SIZE_LIMIT_BYTES || object.bytes.subarray(0, BINARY_SNIFF_LENGTH_BYTES).includes(0)) return [];
  const uri = revisionUri(place.repository.top, file.ref, `${place.repository.prefix}${file.relativePath}`).toString();
  const result: RevisionFile = { root: place.root, relativePath: file.relativePath, uri, text: decoder.decode(object.bytes) };
  if (file.matchableLines) result.matchableLines = file.matchableLines;
  if (file.commit) result.commit = file.commit;
  return [result];
}
