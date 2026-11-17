import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");
const integration = process.argv.includes("--integration");

const extensionBuilds = [
  {
    entryPoints: ["src/extension.ts"],
    outfile: "dist/extension.js",
    platform: "node",
    format: "cjs",
    external: ["vscode"],
    // The UMD build of jsonc-parser loads its parts through a require that esbuild cannot follow.
    mainFields: ["module", "main"],
  },
  {
    entryPoints: { webview: "src/webview/main.ts" },
    outdir: "dist",
    platform: "browser",
    format: "iife",
  },
  {
    entryPoints: { webview: "src/webview/main.css" },
    outdir: "dist",
  },
];

/** The integration tests run inside VS Code, which loads them through mocha from out/. */
const integrationBuilds = [
  {
    entryPoints: { index: "test/integration/suite/index.ts", "search.suite": "test/integration/suite/search.suite.ts" },
    outdir: "out/integration",
    platform: "node",
    format: "cjs",
    external: ["vscode", "mocha"],
  },
];

const builds = integration ? integrationBuilds : extensionBuilds;

for (const options of builds) {
  const context = await esbuild.context({ bundle: true, sourcemap: true, logLevel: "info", ...options });
  if (watch) {
    await context.watch();
  } else {
    await context.rebuild();
    await context.dispose();
  }
}
