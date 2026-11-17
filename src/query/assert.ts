export function assert(condition: boolean, message: string): asserts condition {
    if (!condition) {
        throw new Error(`Assertion failed: ${message}`)
    }
}

export function assertNever(value: never): never {
    throw new Error(`Unreachable: unexpected value ${JSON.stringify(value)}`)
}
