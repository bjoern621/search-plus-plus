// Compares the shipped packages in sbom.cdx.json with a fresh SBOM from the lockfile.
// The tool versions in the metadata differ between machines, so the check skips them.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fresh = join(mkdtempSync(join(tmpdir(), "sbom-")), "sbom.cdx.json");
execFileSync("npx", ["cyclonedx-npm", "--omit", "dev", "--output-reproducible", "--output-format", "JSON", "--output-file", fresh], { stdio: "inherit" });

const packages = (path) => {
  const bom = JSON.parse(readFileSync(path, "utf8"));
  return JSON.stringify({ components: bom.components ?? [], dependencies: bom.dependencies ?? [] });
};

if (packages(fresh) !== packages("sbom.cdx.json")) {
  console.error("sbom.cdx.json lists other packages than the lockfile. Run `npm run sbom` and commit the result.");
  process.exit(1);
}
