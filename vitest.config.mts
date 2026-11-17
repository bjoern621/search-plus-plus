import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Worktrees under .claude/ hold copies of test/, which would run each test once per worktree.
    exclude: [...configDefaults.exclude, ".claude/**"],
  },
});
