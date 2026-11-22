/** The default of `searchPlusPlus.maxResults`: the search stops once this many lines matched, to keep the view and the message channel responsive. */
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

/** The most worker threads that search files at once. The pool also leaves one core to the extension host. */
export const SEARCH_WORKER_COUNT_MAX = 8

/** Files per message to a worker, since a message per file would cost the extension host more than the search. */
export const SEARCH_WORKER_CHUNK_FILES = 16

/** Chunks that a worker holds at once. The second keeps the worker busy while the extension host reads the result of the first. */
export const SEARCH_WORKER_CHUNKS_IN_FLIGHT = 2

/** The workers keep the texts of at most this many bytes on disk between searches, shared out evenly among them. */
export const SEARCH_TEXT_CACHE_MAX_BYTES = 128 * 1024 * 1024

/**
 * The last listing of a root gets replaced in the background once no search took it for this long.
 * A search per keystroke would otherwise start ripgrep per keystroke.
 */
export const LISTING_RELIST_DELAY_DURATION_MS = 2_000

/** The workers quit after this long without a search, to give back their memory. */
export const SEARCH_WORKER_IDLE_DURATION_MS = 60_000
