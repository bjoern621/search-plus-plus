// Times the built-in Search view against the Search++ view in a VS Code window on a virtual display:
// `npm run timing:vscode -- [--folder <path>] [--query <q>]... [--runs <n>] [--code <binary>] [--xvfb <binary>]`.
// A time runs from the input event that sets the query to the last change of the view, followed by a second without changes.
// The run exits with status 1 when Search++ takes longer on any query.
// Search++ matches fuzzy and umlaut variants by default. Its result counts run apart from those of the built-in view.
// It needs Linux with Xvfb. On NixOS: `nix shell nixpkgs#xvfb --command npm run timing:vscode`.
import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { basename, delimiter, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"

const DEFAULT_QUERIES = ["configuration", "Uri", "Größe"]
/** A view counts as done once it stays unchanged this long. */
const QUIET_DURATION_MS = 1000
/** A search that changes the view for longer fails the run. */
const SEARCH_TIMEOUT_DURATION_MS = 20_000
const STARTUP_TIMEOUT_DURATION_MS = 60_000
/** The query input and the element whose changes show the results, in each view. */
const BUILT_IN = { input: ".search-view textarea.input", watched: ".search-view" }
const SEARCH_PLUS_PLUS = { input: "#query", watched: "body" }

const repository = resolve(fileURLToPath(new URL("..", import.meta.url)))
const { values } = parseArgs({
    options: {
        folder: { type: "string", default: repository },
        query: { type: "string", multiple: true },
        runs: { type: "string", default: "5" },
        code: { type: "string", default: "code" },
        xvfb: { type: "string" }
    }
})
const folder = resolve(values.folder)
const runs = Number(values.runs)
const queries = values.query ?? DEFAULT_QUERIES

const scratch = mkdtempSync(join(tmpdir(), "search-plus-plus-timing-"))
const userDir = join(scratch, "user")
const extensionsDir = join(scratch, "extensions")
const children = []

process.on("exit", stopChildren)
for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => {
        stopChildren()
        process.exit(130)
    })

try {
    const failed = await main()
    process.exitCode = failed ? 1 : 0
} finally {
    stopChildren()
}

async function main() {
    const vsix = join(scratch, "searchplusplus.vsix")
    run("npx", ["vsce", "package", "--out", vsix], {
        cwd: repository,
        stdio: ["ignore", "ignore", "inherit"]
    })
    run(values.code, [
        "--user-data-dir",
        userDir,
        "--extensions-dir",
        extensionsDir,
        "--install-extension",
        vsix,
        "--force"
    ])
    writeSettings()

    const display = await startXvfb()
    const port = await freePort()
    startVscode(display, port)
    const workbench = await connect(await workbenchTarget(port))
    await waitFor(() => workbench.evaluate(activityEntryExists("Search++")), "the Search++ view")

    console.log(
        `${folder}: median of ${runs} runs per query after one warm-up run, search on type without delay.`
    )
    const rows = []
    let failed = false
    for (const query of queries) {
        await openView(workbench, "Search")
        const builtIn = await timeRuns(() => workbench.evaluate(timeSearch(BUILT_IN, query)))
        await openView(workbench, "Search++")
        const view = await searchPlusPlusFrame(workbench)
        const ours = await timeRuns(() => view.evaluate(timeSearch(SEARCH_PLUS_PLUS, query)))
        if (ours.ms > builtIn.ms) failed = true
        rows.push({
            query,
            "Search++ ms": ours.ms,
            "built-in ms": builtIn.ms,
            ratio: `${(ours.ms / builtIn.ms).toFixed(2)}x`,
            "Search++ results": ours.summary,
            "built-in results": builtIn.summary
        })
    }
    console.table(rows)
    if (failed) console.error("Search++ takes longer than the built-in Search view on some query.")
    workbench.close()
    return failed
}

function run(command, args, options = {}) {
    const result = spawnSync(command, args, { stdio: "inherit", ...options })
    if (result.status !== 0)
        throw new Error(`${command} ${args.join(" ")} stopped with status ${result.status}`)
}

/** Both views search on type without delay. The timing leaves out the debounce of the input. */
function writeSettings() {
    mkdirSync(join(userDir, "User"), { recursive: true })
    const settings = {
        "search.searchOnTypeDebouncePeriod": 0,
        "workbench.startupEditor": "none",
        "window.restoreWindows": "none",
        "chat.disableAIFeatures": true,
        "extensions.autoUpdate": false,
        "update.mode": "none",
        "telemetry.telemetryLevel": "off"
    }
    writeFileSync(join(userDir, "User", "settings.json"), JSON.stringify(settings, null, 4))
}

/**
 * Starts Xvfb on the first free display from :90 and returns its name.
 * A window on a compositor workspace out of view gets no animation frames, which stalls the Search++ view.
 */
async function startXvfb() {
    const xvfb = values.xvfb ?? onPath("Xvfb")
    if (!xvfb)
        throw new Error("No Xvfb on the PATH. Pass --xvfb <path> or run in a shell that has it.")
    let number = 90
    while (existsSync(`/tmp/.X11-unix/X${number}`)) number++
    const child = spawn(xvfb, [`:${number}`, "-screen", "0", "1600x1000x24", "-nolisten", "tcp"], {
        stdio: "ignore",
        detached: true
    })
    children.push(child)
    await waitFor(() => existsSync(`/tmp/.X11-unix/X${number}`), "Xvfb")
    return `:${number}`
}

/** Opens VS Code on `display` alone: without `WAYLAND_DISPLAY`, the window stays off the desktop of the user. */
function startVscode(display, port) {
    const env = { ...process.env, DISPLAY: display }
    delete env.WAYLAND_DISPLAY
    const child = spawn(
        values.code,
        [
            "--user-data-dir",
            userDir,
            "--extensions-dir",
            extensionsDir,
            "--ozone-platform=x11",
            `--remote-debugging-port=${port}`,
            "--disable-workspace-trust",
            "--skip-welcome",
            "--new-window",
            folder
        ],
        { env, stdio: "ignore", detached: true }
    )
    children.push(child)
}

/** Kills each child with its process group, since the `code` launcher hands the window to child processes. */
function stopChildren() {
    for (const child of children.splice(0)) {
        try {
            process.kill(-child.pid, "SIGTERM")
        } catch {
            // The group has ended.
        }
    }
}

function onPath(name) {
    return (process.env.PATH ?? "")
        .split(delimiter)
        .map((dir) => join(dir, name))
        .find(existsSync)
}

function freePort() {
    return new Promise((resolvePort, reject) => {
        const server = createServer()
        server.on("error", reject)
        server.listen(0, "127.0.0.1", () => {
            const { port } = server.address()
            server.close(() => resolvePort(port))
        })
    })
}

async function waitFor(check, what) {
    const deadline = Date.now() + STARTUP_TIMEOUT_DURATION_MS
    while (Date.now() < deadline) {
        try {
            if (await check()) return
        } catch {
            // Not ready yet.
        }
        await sleep(250)
    }
    throw new Error(`${what} did not start within ${STARTUP_TIMEOUT_DURATION_MS} ms`)
}

function sleep(ms) {
    return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

async function workbenchTarget(port) {
    let target
    await waitFor(async () => {
        const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
        target = targets.find((t) => t.type === "page" && t.title.includes(basename(folder)))
        return target !== undefined
    }, "the VS Code window")
    return target.webSocketDebuggerUrl
}

/** Connects to a page over the Chrome DevTools Protocol. `evaluate` runs an expression in the page. `evaluateIn` runs it in `contextId` of `sessionId`. */
async function connect(url) {
    const socket = new WebSocket(url)
    const pending = new Map()
    const events = []
    let id = 0
    socket.onmessage = (message) => {
        const data = JSON.parse(message.data)
        if (data.id !== undefined && pending.has(data.id)) {
            pending.get(data.id)(data)
            pending.delete(data.id)
        } else events.push(data)
    }
    await new Promise((resolveOpen, reject) => {
        socket.onopen = resolveOpen
        socket.onerror = reject
    })
    const send = (method, params = {}, sessionId) =>
        new Promise((resolveSend) => {
            const messageId = ++id
            pending.set(messageId, resolveSend)
            socket.send(JSON.stringify({ id: messageId, method, params, sessionId }))
        })
    const evaluate = async (expression, sessionId, contextId) => {
        const reply = await send(
            "Runtime.evaluate",
            { expression, contextId, awaitPromise: true, returnByValue: true },
            sessionId
        )
        if (reply.result?.exceptionDetails)
            throw new Error(reply.result.exceptionDetails.exception?.description ?? expression)
        return reply.result?.result?.value
    }
    return {
        send,
        events,
        evaluate: (expression) => evaluate(expression),
        evaluateIn: evaluate,
        close: () => socket.close()
    }
}

function activityEntryExists(label) {
    return `[...document.querySelectorAll(".activitybar .action-item a")].some((a) => a.getAttribute("aria-label")?.replace(/ \\(.*\\)$/, "") === ${JSON.stringify(label)})`
}

async function openView(workbench, label) {
    await workbench.evaluate(
        `[...document.querySelectorAll(".activitybar .action-item a")].find((a) => a.getAttribute("aria-label")?.replace(/ \\(.*\\)$/, "") === ${JSON.stringify(label)}).click()`
    )
    await sleep(1500)
}

/** Finds the frame of the Search++ view among the webview frames and returns a handle that evaluates in it. */
async function searchPlusPlusFrame(workbench) {
    let found
    await waitFor(async () => {
        const { result } = await workbench.send("Target.getTargets")
        for (const target of result.targetInfos.filter((t) => t.type === "iframe")) {
            const attached = await workbench.send("Target.attachToTarget", {
                targetId: target.targetId,
                flatten: true
            })
            const sessionId = attached.result.sessionId
            await workbench.send("Runtime.enable", {}, sessionId)
            await sleep(300)
            const contexts = workbench.events
                .filter(
                    (event) =>
                        event.sessionId === sessionId &&
                        event.method === "Runtime.executionContextCreated"
                )
                .map((event) => event.params.context.id)
            for (const contextId of contexts) {
                const hasQuery = await workbench
                    .evaluateIn("!!document.querySelector('#query')", sessionId, contextId)
                    .catch(() => false)
                if (hasQuery) {
                    found = {
                        evaluate: (expression) =>
                            workbench.evaluateIn(expression, sessionId, contextId)
                    }
                    return true
                }
            }
        }
        return false
    }, "the Search++ view")
    return found
}

/**
 * Builds an expression that clears the query, sets `query` and resolves to the time until the view settles, with its result summary.
 * A scrollbar fades out a while after the results show. Its changes stay out of the time.
 * The time ends at the last change of the view before `QUIET_DURATION_MS` without changes.
 */
function timeSearch(view, query) {
    return `(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        const input = document.querySelector(${JSON.stringify(view.input)})
        const type = (text) => {
            input.value = text
            input.dispatchEvent(new Event("input", { bubbles: true }))
        }
        type("")
        await sleep(${QUIET_DURATION_MS})
        const watched = document.querySelector(${JSON.stringify(view.watched)})
        let lastChange = -1
        const isScrollbar = (node) => (node instanceof Element ? node : node.parentElement)?.closest(".scrollbar") != null
        const observer = new MutationObserver((records) => {
            if (records.some((record) => !isScrollbar(record.target))) lastChange = performance.now()
        })
        observer.observe(watched, { subtree: true, childList: true, characterData: true, attributes: true })
        const started = performance.now()
        type(${JSON.stringify(query)})
        while (lastChange < 0 || performance.now() - lastChange < ${QUIET_DURATION_MS}) {
            if (performance.now() - started > ${SEARCH_TIMEOUT_DURATION_MS}) throw new Error("the view kept changing")
            await sleep(20)
        }
        observer.disconnect()
        const summary = /\\d+ results? in \\d+ files?/.exec(watched.textContent)?.[0] ?? "no summary"
        return { ms: lastChange - started, summary }
    })()`
}

/** Runs one warm-up and `runs` timed searches. Returns the median time and the summary of the last run. */
async function timeRuns(search) {
    await search()
    const samples = []
    for (let index = 0; index < runs; index++) samples.push(await search())
    const sorted = samples.map((sample) => sample.ms).sort((a, b) => a - b)
    return {
        ms: Math.round(sorted[Math.floor(sorted.length / 2)]),
        summary: samples.at(-1).summary
    }
}
