import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runTests } from "@vscode/test-electron";

const here = dirname(fileURLToPath(import.meta.url));
const scratch = await mkdtemp(join(tmpdir(), "structural-search-"));
const workspace = join(scratch, "workspace");

/**
 * Turns the workspace into a repository whose history the Git scope tests search.
 * main holds the first commit, with tag 4.0.0 in values.yaml and upgrade.md and without sizing.md.
 * The branch feature raises the tag to 5.0.0.
 * The checked-out branch topic raises it to 4.1.0, so the working tree matches the fixture.
 * upgrade.md stays changed and sizing.md untracked.
 */
async function commitFixtureHistory() {
  const values = join(workspace, "charts/apim/values.yaml");
  const upgrade = join(workspace, "docs/upgrade.md");
  const sizing = join(workspace, "docs/sizing.md");
  const fixtureValues = await readFile(values, "utf8");
  const fixtureUpgrade = await readFile(upgrade, "utf8");
  const fixtureSizing = await readFile(sizing, "utf8");
  const commit = (message, date) => git({ GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }, "commit", "--quiet", "--all", "--message", message);

  git({}, "init", "--quiet", "--initial-branch=main");
  await writeFile(values, fixtureValues.replace("4.1.0", "4.0.0"));
  await writeFile(upgrade, fixtureUpgrade.replace("4.1.0", "4.0.0"));
  await rm(sizing);
  git({}, "add", ".");
  commit("Add the gateway chart", "2026-11-01T10:00:00+01:00");

  git({}, "switch", "--quiet", "--create", "feature");
  await writeFile(values, fixtureValues.replace("4.1.0", "5.0.0"));
  commit("Try the gateway 5.0.0", "2026-11-02T10:00:00+01:00");

  git({}, "switch", "--quiet", "--create", "topic", "main");
  await writeFile(values, fixtureValues);
  commit("Raise the gateway to 4.1.0", "2026-11-03T10:00:00+01:00");

  await writeFile(upgrade, fixtureUpgrade);
  await writeFile(sizing, fixtureSizing);
}

/** Runs git in the workspace, apart from the Git configuration of the machine. */
function git(env, ...args) {
  execFileSync("git", args, {
    cwd: workspace,
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "Ada Lovelace", GIT_AUTHOR_EMAIL: "ada@example.com", GIT_COMMITTER_NAME: "Ada Lovelace", GIT_COMMITTER_EMAIL: "ada@example.com", ...env },
  });
}

try {
  await cp(join(here, "fixture"), workspace, { recursive: true });
  await commitFixtureHistory();

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
