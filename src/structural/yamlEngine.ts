import type { FileInfo, LineMatch, Query, SearchEngine, SearchFile } from "../search/types"
import { compareKeyDefault } from "./compareKeyDefault"
import { isFileOfKind, keyPathOf, YAML_FILES } from "./fileKinds"
import { KeyPathCollector, SearchAborted } from "./keyPathCollector"
import { maskTemplateActions } from "./templateActions"
import { readYamlDocuments, type YamlDocument, type YamlEntry, type YamlNode } from "./yamlTree"

/** Nodes that a document may visit through aliases and merge keys, to stop alias bombs such as "billion laughs". */
const ALIAS_NODE_BUDGET = 100_000

/**
 * Finds key paths in YAML files, Helm values and templates included.
 * Each document of a multi-document file starts its own key path.
 * An alias contributes the keys of its anchor, and a merge key (`<<`) the keys of its maps.
 * Those keys match at the lines of the anchor.
 * A key and a merged key with the same name keep the key, as YAML merges them.
 */
export const yamlEngine: SearchEngine = {
    id: "yamlKeyPath",

    accepts(file: FileInfo, query: Query): boolean {
        return keyPathOf(query) !== undefined && isFileOfKind(file, YAML_FILES)
    },

    search(file: SearchFile, query: Query, signal: AbortSignal): LineMatch[] {
        const pattern = keyPathOf(query)
        if (pattern === undefined) {
            return []
        }
        const collector = new KeyPathCollector(file.text, pattern, compareKeyDefault, signal)
        try {
            for (const document of readYamlDocuments(maskTemplateActions(file.text))) {
                new DocumentWalk(document, collector).walk()
            }
        } catch (error) {
            if (error instanceof SearchAborted) {
                return []
            }
            throw error
        }
        return collector.results()
    }
}

class DocumentWalk {
    private readonly keys: string[] = []
    /** Anchored nodes whose alias the walk is inside, to stop a cycle. */
    private readonly expanding = new Set<YamlNode>()
    private aliasNodesLeft = ALIAS_NODE_BUDGET

    constructor(
        private readonly document: YamlDocument,
        private readonly collector: KeyPathCollector
    ) {}

    walk(): void {
        this.walkChildren(this.document.root)
    }

    /** Visits the children of a map or a sequence and everything below them. A scalar has none. */
    private walkChildren(node: YamlNode | undefined): void {
        switch (node?.kind) {
            case "alias":
                this.walkAliased(node.name, (target) => this.walkChildren(target))
                return
            case "map":
                this.walkEntries(node.entries, new Set(), false)
                return
            case "seq":
                node.items.forEach((item, index) => {
                    this.keys.push(String(index))
                    this.visit(item.start, item.end)
                    this.walkChildren(item.value)
                    this.keys.pop()
                })
                return
            default:
                return
        }
    }

    /**
     * Visits the entries of one map, then the entries that its merge keys pull in.
     * `taken` holds the keys that the map has visited.
     * A merged entry whose key the map holds already stays out, while a key written twice shows twice.
     */
    private walkEntries(entries: YamlEntry[], taken: Set<string>, merged: boolean): void {
        const merges: YamlNode[] = []
        for (const entry of entries) {
            if (entry.isMerge) {
                if (entry.value !== undefined) {
                    merges.push(entry.value)
                }
                continue
            }
            if (merged && taken.has(entry.key)) {
                continue
            }
            taken.add(entry.key)
            this.keys.push(entry.key)
            this.visit(entry.start, entry.end)
            this.walkChildren(entry.value)
            this.keys.pop()
        }
        for (const merge of merges) {
            const sources = merge.kind === "seq" ? merge.items.map((item) => item.value) : [merge]
            for (const source of sources) {
                this.walkMerged(source, taken)
            }
        }
    }

    private walkMerged(source: YamlNode | undefined, taken: Set<string>): void {
        if (source?.kind === "alias") {
            this.walkAliased(source.name, (target) => this.walkMerged(target, taken))
            return
        }
        if (source?.kind === "map") {
            this.walkEntries(source.entries, taken, true)
        }
    }

    /** Walks the anchored node of an alias, unless the walk is inside it already or the alias budget ran out. */
    private walkAliased(name: string, walk: (target: YamlNode) => void): void {
        const target = this.document.anchors.get(name)
        if (target === undefined || this.expanding.has(target) || this.aliasNodesLeft <= 0) {
            return
        }
        this.expanding.add(target)
        walk(target)
        this.expanding.delete(target)
    }

    private visit(start: number, end: number): void {
        const throughAlias = this.expanding.size > 0
        if (throughAlias) {
            this.aliasNodesLeft--
        }
        this.collector.visit(this.keys, start, end, throughAlias)
    }
}
