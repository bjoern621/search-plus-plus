import * as esbuild from "esbuild"

const watch = process.argv.includes("--watch")

const builds = [
    {
        entryPoints: ["src/extension.ts"],
        outfile: "dist/extension.js",
        platform: "node",
        format: "cjs",
        external: ["vscode"],
        // The UMD build of jsonc-parser loads its parts through a require that esbuild cannot follow.
        mainFields: ["module", "main"]
    },
    {
        entryPoints: { searchWorker: "src/search/worker/searchWorker.ts" },
        outdir: "dist",
        platform: "node",
        format: "cjs",
        mainFields: ["module", "main"]
    },
    {
        entryPoints: { webview: "src/webview/main.ts" },
        outdir: "dist",
        platform: "browser",
        format: "iife"
    },
    {
        entryPoints: { webview: "src/webview/main.css" },
        outdir: "dist",
        loader: { ".ttf": "file" }
    }
]

for (const options of builds) {
    const context = await esbuild.context({
        bundle: true,
        sourcemap: true,
        logLevel: "info",
        ...options
    })
    if (watch) {
        await context.watch()
    } else {
        await context.rebuild()
        await context.dispose()
    }
}
