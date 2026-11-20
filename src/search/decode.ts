import { BINARY_SNIFF_LENGTH_BYTES } from "./config"

const decoder = new TextDecoder("utf-8")

/** Decodes the bytes of a file as UTF-8. Returns undefined for a binary file. */
export function searchTextOf(bytes: Uint8Array): string | undefined {
    if (bytes.subarray(0, BINARY_SNIFF_LENGTH_BYTES).includes(0)) return undefined
    return decoder.decode(bytes)
}
