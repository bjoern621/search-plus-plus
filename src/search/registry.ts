import { API_VERSION, type Disposable, type SearchPlusPlusApi } from "../api"
import { keyPathEngine } from "../structural/keyPathEngine"
import type { SearchEngine } from "./types"

export class EngineRegistry {
    /** Maps an engine id to its engine. */
    private readonly engines = new Map<string, SearchEngine>()

    register(engine: SearchEngine): Disposable {
        if (!engine.id)
            throw new Error(
                "A search engine needs an id. Set `id` to a name unique across extensions."
            )
        if (this.engines.has(engine.id))
            throw new Error(
                `A search engine with the id ${engine.id} is registered already. Pick another id.`
            )
        this.engines.set(engine.id, engine)
        return {
            dispose: () => {
                if (this.engines.get(engine.id) === engine) this.engines.delete(engine.id)
            }
        }
    }

    /** Returns a copy, so a registration during a search leaves that search alone. */
    list(): SearchEngine[] {
        return [...this.engines.values()]
    }
}

/** The API that `activate` returns, with every registration going into `registry`. */
export function searchPlusPlusApi(registry: EngineRegistry): SearchPlusPlusApi {
    return {
        apiVersion: API_VERSION,
        registerEngine: (engine) => registry.register(engine),
        registerKeyPathFiles: (files) => registry.register(keyPathEngine(files))
    }
}
