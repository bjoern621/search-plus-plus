/** The search stops once this many lines matched, to keep the view and the message channel responsive. */
export const RESULT_LINE_LIMIT = 10_000

export const BATCH_INTERVAL_DURATION_MS = 100

export const FILE_READ_CONCURRENCY = 16

/** Larger files stay unsearched, as minified bundles and data dumps flood the results. */
export const FILE_SIZE_LIMIT_BYTES = 5 * 1024 * 1024

/** A NUL byte in this many leading bytes marks a file as binary, as ripgrep decides. */
export const BINARY_SNIFF_LENGTH_BYTES = 8192

/** A longer line reaches the view as an excerpt around its first match. */
export const LINE_EXCERPT_LENGTH_CHARS = 300

/** Characters of the excerpt before the first match, so the match keeps some of its line. */
export const LINE_EXCERPT_LEAD_CHARS = 40

/** The bounds that VS Code sets on `workbench.tree.indent`. */
export const TREE_INDENT_MIN_PX = 4
export const TREE_INDENT_MAX_PX = 40
