import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { vscode: fileURLToPath(new URL("./test/vscodeStub.ts", import.meta.url)) },
  },
  test: {
    // Worktrees under .claude/ hold copies of test/, which would run each test once per worktree.
    exclude: [...configDefaults.exclude, ".claude/**"],
  },
});
