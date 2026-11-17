import type * as vscode from "vscode";
import type { SearchEngine } from "./types";

/** The API that `activate` returns to other extensions. */
export interface StructuralSearchApi {
  /**
   * Adds a search engine to every search that starts after the call.
   * Throws if the id is empty or an engine with the same id is registered already.
   * Disposing the result removes the engine.
   */
  registerEngine(engine: SearchEngine): vscode.Disposable;
}

export class EngineRegistry {
  /** Maps an engine id to its engine. */
  private readonly engines = new Map<string, SearchEngine>();

  register(engine: SearchEngine): vscode.Disposable {
    if (!engine.id) throw new Error("A search engine needs an id. Set `id` to a name unique across extensions.");
    if (this.engines.has(engine.id)) throw new Error(`A search engine with the id ${engine.id} is registered already. Pick another id.`);
    this.engines.set(engine.id, engine);
    return {
      dispose: () => {
        if (this.engines.get(engine.id) === engine) this.engines.delete(engine.id);
      },
    };
  }

  /** Returns a copy, so a registration during a search leaves that search alone. */
  list(): SearchEngine[] {
    return [...this.engines.values()];
  }
}
