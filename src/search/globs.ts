/** The files to include and exclude fields of the view. Each holds glob entries separated by commas. */
export interface FileFields {
  include: string;
  exclude: string;
  /**
   * The toggle in files to exclude, as in the built-in Search view.
   * False leaves out the `files.exclude` and `search.exclude` settings and the ignore files. Undefined counts as true.
   */
  useExcludeSettingsAndIgnoreFiles?: boolean;
}

export const NO_FILE_FIELDS: FileFields = { include: "", exclude: "" };

/**
 * Decides whether a file passes the files to include and exclude fields, as the built-in Search view reads them.
 * An empty include field lets every file pass.
 * Paths are relative to their workspace folder, with `/` as separator.
 */
export class PathFilter {
  private readonly include: RegExp[];
  private readonly exclude: RegExp[];

  constructor(fields: FileFields) {
    this.include = fieldGlobs(fields.include).map(globToRegExp);
    this.exclude = fieldGlobs(fields.exclude).map(globToRegExp);
  }

  accepts(relativePath: string): boolean {
    if (this.include.length > 0 && !this.include.some((glob) => glob.test(relativePath))) return false;
    return !this.exclude.some((glob) => glob.test(relativePath));
  }
}

/** Splits a field at commas outside braces. Trims each entry and drops empty ones. */
export function splitEntries(text: string): string[] {
  const entries: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of text) {
    if (char === "{") depth++;
    if (char === "}") depth = Math.max(0, depth - 1);
    if (char === "," && depth === 0) {
      entries.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  entries.push(current);
  return entries.map((entry) => entry.trim()).filter((entry) => entry !== "");
}

/** Returns the globs of every entry in a field, relative to a workspace folder. */
export function fieldGlobs(text: string): string[] {
  return splitEntries(text).flatMap(entryGlobs);
}

/**
 * Turns one entry into globs relative to a workspace folder, as VS Code does.
 * An entry starting with `./` or `/` starts at the workspace folder. Any other entry matches at any depth.
 * Each entry matches its path and everything below it: `charts/apim` covers `charts/apim/values.yaml`.
 */
export function entryGlobs(entry: string): string[] {
  let path = entry.replace(/\/+$/, "");
  if (path.startsWith("./")) path = path.slice(2);
  else if (path.startsWith("/")) path = path.slice(1);
  else if (!path.startsWith("**")) path = `**/${path}`;
  if (path === "" || path === "**") return ["**"];
  return path.endsWith("/**") ? [path] : [path, `${path}/**`];
}

/**
 * Compiles a VS Code glob into a regular expression over a whole relative path.
 * `**` as a whole segment spans any number of folders, `*` and `?` stay inside one, `[...]` and `{a,b}` work as in VS Code.
 * A `[` or `{` left open matches itself.
 */
export function globToRegExp(glob: string): RegExp {
  return new RegExp(`^${globSource(glob, false)}$`);
}

function globSource(glob: string, inGroup: boolean): string {
  let source = "";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i] as string;
    const segmentStart = i === 0 || glob[i - 1] === "/";
    if (char === "/" && glob.slice(i + 1) === "**") {
      source += "(?:/.*)?";
      break;
    }
    if (char === "*" && glob[i + 1] === "*" && segmentStart && glob[i + 2] === "/") {
      source += "(?:.*/)?";
      i += 2;
      continue;
    }
    if (char === "*" && glob[i + 1] === "*") {
      source += ".*";
      i += 1;
      continue;
    }
    if (char === "*") {
      source += "[^/]*";
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      continue;
    }
    if (char === "[") {
      const close = glob.indexOf("]", i + 2);
      if (close >= 0) {
        source += classSource(glob.slice(i + 1, close));
        i = close;
        continue;
      }
    }
    if (char === "{" && !inGroup) {
      const close = glob.indexOf("}", i + 1);
      if (close >= 0) {
        const alternatives = glob.slice(i + 1, close).split(",");
        source += `(?:${alternatives.map((alternative) => globSource(alternative, true)).join("|")})`;
        i = close;
        continue;
      }
    }
    source += escapeRegExp(char);
  }
  return source;
}

/** Turns the inside of `[...]` into a regex class. A leading `!` or `^` negates it. */
function classSource(body: string): string {
  const negated = body.startsWith("!") || body.startsWith("^");
  const items = (negated ? body.slice(1) : body).replace(/[\\\]^]/g, (char) => `\\${char}`);
  return `[${negated ? "^" : ""}${items}]`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, (char) => `\\${char}`);
}

/**
 * Expands the brace groups of a glob into one glob per alternative: `*.{log,tmp}` gives `*.log` and `*.tmp`.
 * Groups may nest. A `{` without its `}` stays as written, and so does every group after it.
 */
export function expandBraces(glob: string): string[] {
  const open = glob.indexOf("{");
  if (open < 0) return [glob];
  const close = closingBrace(glob, open);
  if (close < 0) return [glob];
  const prefix = glob.slice(0, open);
  const suffix = glob.slice(close + 1);
  return topLevelAlternatives(glob.slice(open + 1, close)).flatMap((alternative) => expandBraces(`${prefix}${alternative}${suffix}`));
}

/** Returns the index of the `}` that closes the `{` at `open`, or -1 if none does. */
function closingBrace(glob: string, open: number): number {
  let depth = 0;
  for (let i = open; i < glob.length; i++) {
    if (glob[i] === "{") depth++;
    if (glob[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

/** Splits the inside of a brace group at the commas outside nested groups. Keeps empty alternatives, as in `file{,.bak}`. */
function topLevelAlternatives(body: string): string[] {
  const alternatives: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of body) {
    if (char === "{") depth++;
    if (char === "}") depth--;
    if (char === "," && depth === 0) {
      alternatives.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  alternatives.push(current);
  return alternatives;
}
