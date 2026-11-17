// Stands in for the `vscode` module in unit tests, which run outside VS Code.
// It holds the parts of the API that the search modules call. URIs keep their paths unencoded.

import { readFile, stat } from "node:fs/promises"
import * as path from "node:path"

export class Uri {
    private constructor(
        readonly scheme: string,
        readonly authority: string,
        readonly path: string,
        readonly query: string
    ) {}

    static parse(value: string): Uri {
        const parts = /^([a-z][\w+.-]*):(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?/i.exec(value)
        if (!parts) throw new Error(`Uri.parse cannot read ${value}`)
        return new Uri(parts[1] ?? "", parts[2] ?? "", parts[3] || "/", parts[4] ?? "")
    }

    static file(fsPath: string): Uri {
        return new Uri("file", "", fsPath, "")
    }

    static joinPath(base: Uri, ...segments: string[]): Uri {
        return new Uri(
            base.scheme,
            base.authority,
            path.posix.join(base.path, ...segments),
            base.query
        )
    }

    get fsPath(): string {
        return this.path
    }

    with(change: { scheme?: string; path?: string; query?: string }): Uri {
        return new Uri(
            change.scheme ?? this.scheme,
            this.authority,
            change.path ?? this.path,
            change.query ?? this.query
        )
    }

    toString(): string {
        return `${this.scheme}://${this.authority}${this.path}${this.query === "" ? "" : `?${this.query}`}`
    }
}

export class RelativePattern {
    constructor(
        readonly baseUri: Uri,
        readonly pattern: string
    ) {}
}

export class CancellationTokenSource {
    readonly token = { isCancellationRequested: false }

    cancel(): void {
        this.token.isCancellationRequested = true
    }

    dispose(): void {}
}

export interface StubDocument {
    uri: Uri
    isDirty: boolean
    getText(): string
}

/** Tests replace `textDocuments` and `findFiles` to set what the editor holds and what VS Code lists. */
export const workspace = {
    textDocuments: [] as StubDocument[],
    fs: {
        stat: (uri: Uri) => stat(uri.fsPath),
        readFile: (uri: Uri) => readFile(uri.fsPath)
    },
    findFiles: async (_include: RelativePattern, _exclude?: string): Promise<Uri[]> => []
}
