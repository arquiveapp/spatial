import { readFile, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
export function audit(lock, review) {
  const allowed = new Set([
    "MIT",
    "Apache-2.0",
    "ISC",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "BSL-1.0",
    "Zlib",
    "MPL-2.0",
    "CC0-1.0",
  ]);
  const external = Object.entries(lock.packages).filter(
    ([p, v]) => p.startsWith("node_modules/") && !v.link,
  );
  for (const [path, p] of external) {
    const row = review.components.find((r) => r.path === path);
    if (!allowed.has(p.license)) throw Error(`Unapproved license: ${path}: ${p.license}`);
    if (
      !row ||
      row.version !== p.version ||
      row.license !== p.license ||
      row.integrity !== p.integrity ||
      row.source !== p.resolved ||
      !row.files.length
    )
      throw Error(`Rights review missing or stale: ${path}`);
    if (p.hasInstallScript) throw Error(`Lifecycle script needs review: ${path}`);
    if (!p.dev || row.distribution !== "development-only")
      throw Error(`Runtime dependency requires a shipping-rights gate: ${path}`);
  }
  if (external.length !== review.components.length) throw Error("Stale review entries");
  if (review.native.length)
    throw Error("Native third-party code requires a compiled dependency rights review");
  return external.length;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
  const review = JSON.parse(await readFile("tools/sbom/reviewed.json", "utf8"));
  const count = audit(lock, review);
  for (const row of review.components)
    for (const file of row.files) {
      const bytes = await readFile(file.path);
      if (createHash("sha256").update(bytes).digest("hex") !== file.sha256)
        throw Error(`License/notice changed: ${file.path}`);
    }
  for (const path of [
    ".",
    "packages/core",
    "packages/backend-webxr",
    "packages/backend-vio-lite",
    "packages/renderer-three",
  ]) {
    const p = JSON.parse(await readFile(`${path}/package.json`, "utf8"));
    if (!p.private || p.license !== "MIT") throw Error(`Unreleased MIT invariant: ${path}`);
    if (
      Object.keys(p.dependencies ?? {}).some((n) => n !== "@arquiveapp/spatial-core") ||
      Object.keys(p.optionalDependencies ?? {}).length ||
      Object.keys(p.peerDependencies ?? {}).length
    )
      throw Error(`Dependency rights review required: ${path}`);
  }
  try {
    await access(".github/workflows");
    throw Error("Hosted CI is outside repository policy");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  console.log(
    `Rights gate: ${count} reviewed development components; 0 external runtime or compiled tracking dependencies.`,
  );
}
