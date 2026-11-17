import { describe, expect, it } from "vitest"
import { codeEngine, jsonEngine, tomlEngine, yamlEngine } from "../../src/structural"
import type { SearchEngine } from "../../src/search/types"
import { search } from "./search"

const ONE_MEGABYTE_CHARS = 1_000_000
/**
 * A search may take this many runs of the calibration loop over the same text.
 * The loop runs on the same machine right before the search, so a slow or busy CI runner slows both alike.
 * The bound leaves about twice the room that the slowest search takes.
 */
const MAX_SEARCH_DURATION_CALIBRATION_RUNS = 50
const CALIBRATION_SAMPLE_COUNT = 5

function repeatUntilMegabyte(entry: (i: number) => string): string {
    const parts: string[] = []
    let length = 0
    for (let i = 0; length < ONE_MEGABYTE_CHARS; i++) {
        const part = entry(i)
        parts.push(part)
        length += part.length
    }
    return parts.join("")
}

const yamlText = repeatUntilMegabyte(
    (i) =>
        `service${i}:\n  image:\n    repository: example/app\n    tag: "1.${i}"\n  resources:\n    limits:\n      memory: 512Mi\n  hosts:\n    - a${i}.example.com\n`
)
const jsonText = `{${repeatUntilMegabyte((i) => `${i === 0 ? "" : ","}"service${i}": {"image": {"tag": "1.${i}"}, "resources": {"limits": {"memory": "512Mi"}}, "hosts": ["a${i}.example.com"]}\n`)}}`
const tomlText = repeatUntilMegabyte(
    (i) =>
        `[service${i}.image]\ntag = "1.${i}"\n\n[service${i}.resources.limits]\nmemory = "512Mi"\nhosts = ["a${i}.example.com"]\n\n`
)
const codeText = repeatUntilMegabyte(
    (i) => `const port${i} = this.config.server${i % 7}.port + config?.limits["memory"];\n`
)

/** Cuts the text into runs of letters and digits and lowercases each, as the engines tokenize a file. Returns the median of a few runs. */
function calibrationLoopMs(text: string): number {
    const samples: number[] = []
    for (let sample = 0; sample < CALIBRATION_SAMPLE_COUNT; sample++) {
        const started = performance.now()
        const words = new Set<string>()
        let start = 0
        for (let i = 0; i <= text.length; i++) {
            const code = i < text.length ? text.charCodeAt(i) : 0
            if (
                (code >= 48 && code <= 57) ||
                (code >= 65 && code <= 90) ||
                (code >= 97 && code <= 122)
            )
                continue
            if (i > start) words.add(text.slice(start, i).toLowerCase())
            start = i + 1
        }
        expect(words.size).toBeGreaterThan(0)
        samples.push(performance.now() - started)
    }
    return samples.sort((a, b) => a - b)[Math.floor(samples.length / 2)] ?? 0
}

/** Returns how many runs of the calibration loop over `text` the search takes. */
function durationInCalibrationRuns(
    engine: SearchEngine,
    relativePath: string,
    languageId: string,
    text: string,
    query: string
): number {
    const calibrationMs = calibrationLoopMs(text)
    const started = performance.now()
    const matches = search(engine, relativePath, languageId, text, query)
    expect(matches.length).toBeGreaterThan(0)
    return (performance.now() - started) / calibrationMs
}

describe("1 MB files", () => {
    const bound = `within ${MAX_SEARCH_DURATION_CALIBRATION_RUNS} runs of the calibration loop`

    for (const query of ["**.limits.memory", "**.{requests,limits}.memory", "*.Imgae.tag"]) {
        it(`searches YAML for ${query} ${bound}`, () => {
            expect(
                durationInCalibrationRuns(yamlEngine, "values.yaml", "yaml", yamlText, query)
            ).toBeLessThan(MAX_SEARCH_DURATION_CALIBRATION_RUNS)
        })

        it(`searches JSON for ${query} ${bound}`, () => {
            expect(
                durationInCalibrationRuns(jsonEngine, "data.json", "json", jsonText, query)
            ).toBeLessThan(MAX_SEARCH_DURATION_CALIBRATION_RUNS)
        })

        it(`searches TOML for ${query} ${bound}`, () => {
            expect(
                durationInCalibrationRuns(tomlEngine, "data.toml", "toml", tomlText, query)
            ).toBeLessThan(MAX_SEARCH_DURATION_CALIBRATION_RUNS)
        })
    }

    it(`searches code for config.server.port ${bound}`, () => {
        expect(
            durationInCalibrationRuns(
                codeEngine,
                "a.ts",
                "typescript",
                codeText,
                "config.server*.port"
            )
        ).toBeLessThan(MAX_SEARCH_DURATION_CALIBRATION_RUNS)
    })
})
