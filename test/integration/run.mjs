import { cp, mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runTests } from "@vscode/test-electron";

const here = dirname(fileURLToPath(import.meta.url));
const scratch = await mkdtemp(join(tmpdir(), "structural-search-"));
const workspace = join(scratch, "workspace");

try {
  // The fixture keeps its ignore file under another name, so the repository's own Git leaves its ignored folder tracked.
  await cp(join(here, "fixture"), workspace, { recursive: true });
  await rename(join(workspace, "gitignore"), join(workspace, ".gitignore"));

  await runTests({
    // Unset, it downloads VS Code stable into .vscode-test/.
    vscodeExecutablePath: process.env.VSCODE_EXECUTABLE || undefined,
    extensionDevelopmentPath: resolve(here, "../.."),
    extensionTestsPath: resolve(here, "../../out/integration/index.js"),
    // Its own profile keeps the test away from a VS Code that runs already.
    launchArgs: [
      workspace,
      "--disable-extensions",
      "--disable-workspace-trust",
      "--skip-welcome",
      "--skip-release-notes",
      "--password-store=basic",
      `--user-data-dir=${join(scratch, "user-data")}`,
      `--extensions-dir=${join(scratch, "extensions")}`,
    ],
  });
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await rm(scratch, { recursive: true, force: true });
}
