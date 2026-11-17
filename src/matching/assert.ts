export function assert(condition: boolean, message: string): asserts condition {
    if (!condition) {
        throw new Error(`[ASSERT] ${message}`)
    }
}

export function never(message: string): never {
    throw new Error(`[ASSERT] ${message}`)
}
