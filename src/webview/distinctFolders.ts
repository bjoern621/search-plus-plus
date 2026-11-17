/** A path's folders in columns, `undefined` where the path holds no folder. The folder nearest the file sits last. */
type Columns = readonly (string | undefined)[]

/**
 * Picks the folders that tell apart files of the same name, such as `atticd-speed` in `.claude/worktrees/atticd-speed/argocd/docs.md`.
 * Takes the folders of each path and returns, per path, the indices of its distinguishing folders in ascending order.
 *
 * Every path takes the same columns, so all rows show the same section of their paths.
 * The columns line up either at the first folder or at the folder holding the file.
 * The alignment that tells more paths apart wins, then the one needing fewer columns, then the one lined up at the file.
 * A path without a folder in a picked column leaves that column out.
 */
export function distinctFolderIndices(paths: readonly (readonly string[])[]): number[][] {
    if (paths.length < 2) return paths.map(() => [])
    const width = Math.max(...paths.map((path) => path.length))
    const fromStart = pickColumns(
        paths.map((path) => [...path, ...Array<undefined>(width - path.length)])
    )
    const fromEnd = pickColumns(
        paths.map((path) => [...Array<undefined>(width - path.length), ...path])
    )
    const useEnd =
        fromEnd.groups > fromStart.groups ||
        (fromEnd.groups === fromStart.groups && fromEnd.columns.length <= fromStart.columns.length)
    return paths.map((path) => {
        const shift = useEnd ? width - path.length : 0
        const columns = useEnd ? fromEnd.columns : fromStart.columns
        return columns
            .map((column) => column - shift)
            .filter((index) => index >= 0 && index < path.length)
            .sort((a, b) => a - b)
    })
}

/**
 * Picks columns one at a time: each pick takes the column that splits the paths not yet told apart into the most groups.
 * On a tie, the column nearer the file name wins, since it leaves less path to show behind it.
 * The picking stops once every path stands apart or no column splits further.
 */
function pickColumns(paths: readonly Columns[]): { columns: number[]; groups: number } {
    const width = paths[0]?.length ?? 0
    let groups = [paths.map((_, index) => index)]
    const columns: number[] = []
    while (groups.some((group) => group.length > 1)) {
        let best: { column: number; groups: number[][] } | undefined
        for (let column = 0; column < width; column++) {
            if (columns.includes(column)) continue
            const split = groups.flatMap((group) => splitByColumn(paths, group, column))
            if (
                split.length > (best?.groups.length ?? groups.length) ||
                (best && split.length === best.groups.length)
            )
                best = { column, groups: split }
        }
        if (!best) break
        columns.push(best.column)
        groups = best.groups
    }
    return { columns, groups: groups.length }
}

/** Splits `group`, a list of indices into `paths`, by the folder that each path holds in `column`. Paths without a folder there form one group. */
function splitByColumn(
    paths: readonly Columns[],
    group: readonly number[],
    column: number
): number[][] {
    const byFolder = new Map<string | undefined, number[]>()
    for (const index of group) {
        const folder = paths[index]?.[column]
        const members = byFolder.get(folder)
        if (members) members.push(index)
        else byFolder.set(folder, [index])
    }
    return [...byFolder.values()]
}
