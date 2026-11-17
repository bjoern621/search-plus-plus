/** Collects items and sends them together at most once per interval. */
export class BatchSender<T> {
    private items: T[] = []
    private timer: ReturnType<typeof setTimeout> | undefined

    constructor(
        private readonly send: (items: T[]) => void,
        private readonly intervalMs: number
    ) {}

    push(item: T): void {
        this.items.push(item)
        this.timer ??= setTimeout(() => this.flush(), this.intervalMs)
    }

    /** Sends what has piled up at once. Sends nothing when nothing has. */
    flush(): void {
        clearTimeout(this.timer)
        this.timer = undefined
        if (this.items.length === 0) return
        const batch = this.items
        this.items = []
        this.send(batch)
    }
}
