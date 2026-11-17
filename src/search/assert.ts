/** Throws when `condition` is false. `message` names the rule that broke. */
export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

/** Marks a branch that the types rule out. */
export function assertNever(value: never): never {
  throw new Error(`Unreachable branch reached with ${JSON.stringify(value)}`);
}
