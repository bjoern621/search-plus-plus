// Compares the shipped packages in sbom.cdx.json with a fresh SBOM from the lockfile.
// The tool versions in the metadata differ between machines, so the check skips them.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// `npm ls` reports the integrity hash of each package after `npm install` and leaves it out after `npm ci`.
// The generator copies it into `hashes` and names its source in `comment`, so both stay out of the comparison.
const INSTALL_TRACE_KEYS = new Set(["hashes", "comment"]);

const fresh = join(mkdtempSync(join(tmpdir(), "sbom-")), "sbom.cdx.json");
execFileSync("npx", ["cyclonedx-npm", "--omit", "dev", "--output-reproducible", "--output-format", "JSON", "--output-file", fresh], { stdio: "inherit" });

/** Drops the keys in `INSTALL_TRACE_KEYS` at every depth. */
function withoutInstallTraces(value) {
  if (Array.isArray(value)) return value.map(withoutInstallTraces);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !INSTALL_TRACE_KEYS.has(key)).map(([key, inner]) => [key, withoutInstallTraces(inner)]));
}

function packages(path) {
  const bom = JSON.parse(readFileSync(path, "utf8"));
  return JSON.stringify(withoutInstallTraces({ components: bom.components ?? [], dependencies: bom.dependencies ?? [] }));
}

if (packages(fresh) !== packages("sbom.cdx.json")) {
  console.error("sbom.cdx.json lists other packages than the lockfile. Run `npm run sbom` and commit the result.");
  process.exit(1);
}
