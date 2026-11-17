import { FILE_SIZE_LIMIT_BYTES } from "./config";

/** The settings of one workspace folder that decide which files a search reads. */
export interface WalkSettings {
  /** Glob patterns of `files.exclude` and `search.exclude` set to true. */
  excludeGlobs: string[];
  useIgnoreFiles: boolean;
  useParentIgnoreFiles: boolean;
  useGlobalIgnoreFiles: boolean;
  followSymlinks: boolean;
}

/** An exclude setting maps a glob to true, false or a `when` clause. */
export type ExcludeSetting = Record<string, unknown>;

/**
 * Collects the globs that an exclude setting turns on.
 * Globs with a `when` clause stay out, since ripgrep cannot test a sibling file.
 */
export function enabledGlobs(...settings: (ExcludeSetting | undefined)[]): string[] {
  const globs = new Set<string>();
  for (const setting of settings) {
    for (const [glob, enabled] of Object.entries(setting ?? {})) {
      if (enabled === true && glob !== "") globs.add(glob);
    }
  }
  return [...globs];
}

/**
 * Builds the ripgrep arguments that pick the files of one workspace folder.
 * They mirror the arguments that VS Code passes to ripgrep for its own search.
 */
export function ripgrepWalkArgs(settings: WalkSettings): string[] {
  const args = ["--no-config", "--hidden", "--no-require-git", "--max-filesize", String(FILE_SIZE_LIMIT_BYTES)];
  for (const glob of settings.excludeGlobs) args.push("-g", `!${anchorGlob(glob)}`);
  if (!settings.useIgnoreFiles) args.push("--no-ignore");
  else if (!settings.useParentIgnoreFiles) args.push("--no-ignore-parent");
  if (!settings.useGlobalIgnoreFiles) args.push("--no-ignore-global");
  if (settings.followSymlinks) args.push("--follow");
  return args;
}

/** A VS Code glob without `**` or `/` in front matches from the folder root. ripgrep needs the leading `/` for that. */
function anchorGlob(glob: string): string {
  const trimmed = glob.replace(/[/\\]+$/, "");
  return trimmed.startsWith("**") || trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}
