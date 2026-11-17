import * as vscode from "vscode";
import type { FileResult } from "../messages";
import type { Hint } from "../query/types";
import { assert } from "./assert";
import { BatchSender } from "./batch";
import { BATCH_INTERVAL_DURATION_MS, FILE_READ_CONCURRENCY, RESULT_LINE_LIMIT } from "./config";
import { collectFiles } from "./files";
import { type FileFields, PathFilter } from "./globs";
import type { LanguageIndex } from "./languages";
import { LineFeedLineMap } from "./lineFeedLines";
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

/** A file to search and the matches that a workspace engine found in it. */
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
    assert(workspaceEngines.length <= 1, "at most one workspace engine may accept a query, since the search takes up each file once");
  }

  async run(): Promise<void> {
    await this.searchDisk();
    this.sender.flush();
  }

  /**
   * Searches a file once the workspace engine reports it, so its results show while the engine walks on.
   * A file that the workspace engine found but the file list left out still shows.
   * The other listed files follow once the workspace engine ends.
   * The workspace engine reads a file with unsaved changes from disk, so its text in the editor gets searched in place of what the engine reports.
   */
  private async searchDisk(): Promise<void> {
    const fieldFilter = new PathFilter(this.request.fields);
    const queue = new WorkQueue(FILE_READ_CONCURRENCY, this.signal);
    // Nested workspace folders list a file twice.
    const takenUris = new Set<string>();
    const take = (item: PendingFile) => {
      if (!fieldFilter.accepts(item.relativePath)) return;
      const uri = this.fileUri(item.root, item.relativePath);
      if (takenUris.has(uri)) return;
      takenUris.add(uri);
      queue.add(() => this.searchFile(item).catch((error: unknown) => this.deps.log(`Search failed on ${item.relativePath}: ${String(error)}`)));
    };
    const [files] = await Promise.all([
      collectFiles(this.request.roots, this.deps.rgPath, this.signal, this.deps.log),
      this.runWorkspaceEngines((root, relativePath, matches) => {
        if (!this.unsaved.has(this.fileUri(root, relativePath))) take({ root, relativePath, lists: [matches] });
      }),
    ]);
    const unsaved = files.flatMap((file) => {
      const text = this.unsaved.get(this.fileUri(file.root, file.relativePath));
      return text === undefined || !fieldFilter.accepts(file.relativePath) ? [] : [{ file, text }];
    });
    if (unsaved.length > 0) {
      const found = await this.searchTextsWithWorkspaceEngines(unsaved.map((item) => item.text));
      unsaved.forEach(({ file }, index) => take({ root: file.root, relativePath: file.relativePath, lists: found.map((lists) => lists[index] ?? []) }));
    }
    for (const file of files) take({ root: file.root, relativePath: file.relativePath, lists: [] });
    await queue.drained();
  }

  /** Returns per workspace engine the matches of each text in `texts`. */
  private async searchTextsWithWorkspaceEngines(texts: readonly string[]): Promise<LineMatch[][][]> {
    return Promise.all(
      this.workspaceEngines.map((engine) =>
        engine.searchTexts(texts, this.request.query, this.signal).catch((error: unknown) => {
          if (!this.signal.aborted) this.deps.log(`Search engine ${engine.id} failed: ${String(error)}`);
          return [];
        }),
      ),
    );
  }

  private async runWorkspaceEngines(onFile: (root: SearchRoot, relativePath: string, matches: LineMatch[]) => void): Promise<void> {
    await Promise.all(
      this.workspaceEngines.map(async (engine) => {
        try {
          await engine.search(this.request.roots, this.request.query, this.signal, onFile);
        } catch (error) {
          if (!this.signal.aborted) this.deps.log(`Search engine ${engine.id} failed: ${String(error)}`);
        }
      }),
    );
  }

  private async searchFile(item: PendingFile): Promise<void> {
    const file: FileInfo = { uri: this.fileUri(item.root, item.relativePath), relativePath: item.relativePath, languageId: this.languageOf(item.relativePath) };
    const engines = this.fileEngines.filter((engine) => this.accepts(engine, file));
    if (engines.length === 0 && item.lists.length === 0) return;
    const text = await readSearchText(vscode.Uri.parse(file.uri), this.unsaved);
    if (text === undefined || this.signal.aborted) return;

    const lists = workspaceEditorLines(text, item.lists);
    for (const engine of engines) {
      const found = await this.searchWith(engine, { ...file, text });
      if (found) lists.push(found);
    }
    const lines = splitLines(text);
    const merged = mergeLineMatches(lists.map((list) => validMatches(list, lines)));
    this.emit(item.root, file, lines, merged);
  }

  private languageOf(relativePath: string): string {
    return this.languages.languageOf(relativePath.slice(relativePath.lastIndexOf("/") + 1));
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

/** Moves the matches of workspace engines, which count lines as ripgrep does, to the lines of the editor. */
function workspaceEditorLines(text: string, lists: readonly LineMatch[][]): LineMatch[][] {
  if (lists.length === 0) return [];
  const lineFeeds = new LineFeedLineMap(text);
  return lists.map((list) => lineFeeds.toEditorLines(list));
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

/** Runs added work at most `limit` at a time. Drops the waiting work once `signal` aborts. */
class WorkQueue {
  private readonly waiting: (() => Promise<void>)[] = [];
  /** The index in `waiting` of the work that starts next. */
  private next = 0;
  private readonly running = new Set<Promise<void>>();

  constructor(
    private readonly limit: number,
    private readonly signal: AbortSignal,
  ) {}

  /** `work` must not reject. */
  add(work: () => Promise<void>): void {
    if (this.signal.aborted) return;
    this.waiting.push(work);
    this.startWaiting();
  }

  /** Resolves once every work that started has ended. */
  async drained(): Promise<void> {
    while (this.running.size > 0) await Promise.all(this.running);
  }

  private startWaiting(): void {
    while (this.running.size < this.limit && this.next < this.waiting.length && !this.signal.aborted) {
      const work = this.waiting[this.next++]!;
      const running = work().finally(() => {
        this.running.delete(running);
        this.startWaiting();
      });
      this.running.add(running);
    }
    if (this.next === this.waiting.length || this.signal.aborted) {
      this.waiting.length = 0;
      this.next = 0;
    }
  }
}

