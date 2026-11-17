import * as vscode from "vscode";
import type { FileResult } from "../messages";
import type { Hint } from "../query/types";
import { BatchSender } from "./batch";
import { BATCH_INTERVAL_DURATION_MS, FILE_READ_CONCURRENCY, RESULT_LINE_LIMIT } from "./config";
import { collectFiles } from "./files";
import { type FileFields, PathFilter } from "./globs";
import type { LanguageIndex } from "./languages";
import { mergeLineMatches } from "./merge";
import { readSearchText, unsavedTexts } from "./reader";
import type { EngineRegistry } from "./registry";
import { buildFileResult, splitLines } from "./results";
import type { FileInfo, LineMatch, Query, SearchEngine } from "./types";
import type { SearchRoot, WorkspaceSearchEngine } from "./workspaceEngine";

export type SearchOutcome = { status: "complete" } | { status: "capped"; limit: number } | { status: "blocked"; hint: Hint } | { status: "aborted" };

export interface SearchRunnerDeps {
  registry: EngineRegistry;
  workspaceEngines: readonly WorkspaceSearchEngine[];
  rgPath: string | undefined;
  languages: () => LanguageIndex;
  log: (message: string) => void;
}

export interface SearchRequest {
  query: Query;
  roots: readonly SearchRoot[];
  contextLines: number;
  /** The files to include and exclude fields of the view. */
  fields: FileFields;
  signal: AbortSignal;
  /** Receives results in batches, each file once. */
  onBatch: (files: FileResult[]) => void;
}

/** Matches that workspace engines found in one file, waiting for the per-file engines. */
interface PendingFile {
  root: SearchRoot;
  relativePath: string;
  lists: LineMatch[][];
}

export class SearchRunner {
  constructor(private readonly deps: SearchRunnerDeps) {}

  /**
   * Runs the query in every engine that accepts it and streams the merged results.
   * Stops after `RESULT_LINE_LIMIT` matched lines.
   * Aborting the signal ends the search without a final batch.
   */
  async run(request: SearchRequest): Promise<SearchOutcome> {
    const workspaceEngines = this.deps.workspaceEngines.filter((engine) => engine.acceptsQuery(request.query));
    const hint = await this.firstHint(workspaceEngines, request);
    if (request.signal.aborted) return { status: "aborted" };
    if (hint !== undefined) return { status: "blocked", hint };

    const search = new RunningSearch(this.deps, request, this.deps.registry.list(), workspaceEngines);
    await search.run();
    if (request.signal.aborted) return { status: "aborted" };
    return search.capped ? { status: "capped", limit: RESULT_LINE_LIMIT } : { status: "complete" };
  }

  private async firstHint(engines: readonly WorkspaceSearchEngine[], request: SearchRequest): Promise<Hint | undefined> {
    for (const engine of engines) {
      const hint = await engine.check(request.query, request.signal);
      if (hint !== undefined) return hint;
    }
    return undefined;
  }
}

/** The state of one search from its start to its last batch. */
class RunningSearch {
  capped = false;
  private matchedLines = 0;
  private readonly stop = new AbortController();
  private readonly signal: AbortSignal;
  private readonly sender: BatchSender<FileResult>;
  private readonly unsaved = unsavedTexts();
  private readonly languages: LanguageIndex;
  /** Maps a file URI to what the workspace engines found in it. */
  private readonly pending = new Map<string, PendingFile>();

  constructor(
    private readonly deps: SearchRunnerDeps,
    private readonly request: SearchRequest,
    private readonly fileEngines: readonly SearchEngine[],
    private readonly workspaceEngines: readonly WorkspaceSearchEngine[],
  ) {
    this.signal = AbortSignal.any([request.signal, this.stop.signal]);
    this.sender = new BatchSender((files) => {
      if (!request.signal.aborted) request.onBatch(files);
    }, BATCH_INTERVAL_DURATION_MS);
    this.languages = deps.languages();
  }

  async run(): Promise<void> {
    const [files] = await Promise.all([collectFiles(this.request.roots, this.deps.rgPath, this.signal, this.deps.log), this.runWorkspaceEngines()]);
    const filter = new PathFilter(this.request.fields);
    const work = files.filter((file) => filter.accepts(file.relativePath)).map((file) => ({ root: file.root, relativePath: file.relativePath, lists: [] as LineMatch[][] }));
    for (const item of work) {
      const uri = this.fileUri(item.root, item.relativePath);
      const pending = this.pending.get(uri);
      if (!pending) continue;
      item.lists = pending.lists;
      this.pending.delete(uri);
    }
    // Files that a workspace engine found but the file list left out still show.
    work.push(...[...this.pending.values()].filter((item) => filter.accepts(item.relativePath)));
    this.pending.clear();
    await forEachConcurrent(work, FILE_READ_CONCURRENCY, this.signal, (item) =>
      this.searchFile(item).catch((error: unknown) => this.deps.log(`Search failed on ${item.relativePath}: ${String(error)}`)),
    );
    this.sender.flush();
  }

  private async runWorkspaceEngines(): Promise<void> {
    await Promise.all(
      this.workspaceEngines.map(async (engine) => {
        try {
          await engine.search(this.request.roots, this.request.query, this.signal, (root, relativePath, matches) => {
            const uri = this.fileUri(root, relativePath);
            const known = this.pending.get(uri);
            if (known) known.lists.push(matches);
            else this.pending.set(uri, { root, relativePath, lists: [matches] });
          });
        } catch (error) {
          if (!this.signal.aborted) this.deps.log(`Search engine ${engine.id} failed: ${String(error)}`);
        }
      }),
    );
  }

  private async searchFile(item: PendingFile): Promise<void> {
    const file: FileInfo = {
      uri: this.fileUri(item.root, item.relativePath),
      relativePath: item.relativePath,
      languageId: this.languages.languageOf(item.relativePath.slice(item.relativePath.lastIndexOf("/") + 1)),
    };
    const engines = this.fileEngines.filter((engine) => this.accepts(engine, file));
    if (engines.length === 0 && item.lists.length === 0) return;
    const text = await readSearchText(vscode.Uri.parse(file.uri), this.unsaved);
    if (text === undefined || this.signal.aborted) return;

    const lists = [...item.lists];
    for (const engine of engines) {
      const found = await this.searchWith(engine, { ...file, text });
      if (found) lists.push(found);
    }
    const lines = splitLines(text);
    const merged = mergeLineMatches(lists.map((list) => validMatches(list, lines)));
    this.emit(item.root, file, lines, merged);
  }

  private emit(root: SearchRoot, file: FileInfo, lines: string[], merged: LineMatch[]): void {
    const room = RESULT_LINE_LIMIT - this.matchedLines;
    if (merged.length === 0 || room <= 0 || this.signal.aborted) return;
    const kept = merged.slice(0, room);
    this.matchedLines += kept.length;
    if (this.matchedLines >= RESULT_LINE_LIMIT) {
      this.capped = true;
      this.stop.abort();
    }
    const place = { rootIndex: root.index, root: root.name, uri: file.uri, relativePath: file.relativePath, languageId: file.languageId };
    this.sender.push(buildFileResult(place, lines, kept, this.request.contextLines));
  }

  private accepts(engine: SearchEngine, file: FileInfo): boolean {
    try {
      return engine.accepts(file, this.request.query);
    } catch (error) {
      this.deps.log(`Search engine ${engine.id} failed to decide on ${file.relativePath}: ${String(error)}`);
      return false;
    }
  }

  private async searchWith(engine: SearchEngine, file: FileInfo & { text: string }): Promise<LineMatch[] | undefined> {
    try {
      return await engine.search(file, this.request.query, this.signal);
    } catch (error) {
      if (!this.signal.aborted) this.deps.log(`Search engine ${engine.id} failed on ${file.relativePath}: ${String(error)}`);
      return undefined;
    }
  }

  private fileUri(root: SearchRoot, relativePath: string): string {
    return vscode.Uri.joinPath(vscode.Uri.parse(root.uri), relativePath).toString();
  }
}

/** Drops matches that point outside the file and ranges that point outside their line, since engines from other extensions may send them. */
function validMatches(matches: readonly LineMatch[], lines: readonly string[]): LineMatch[] {
  return matches.flatMap((match) => {
    const text = lines[match.line];
    if (!Number.isInteger(match.line) || text === undefined) return [];
    const ranges = match.ranges.filter((range) => range.start >= 0 && range.start <= range.end && range.end <= text.length);
    return [{ ...match, ranges }];
  });
}

/** Runs `work` on each item, at most `limit` at a time, and stops taking items once `signal` aborts. */
async function forEachConcurrent<T>(items: readonly T[], limit: number, signal: AbortSignal, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (!signal.aborted && next < items.length) {
      const item = items[next++] as T;
      await work(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
