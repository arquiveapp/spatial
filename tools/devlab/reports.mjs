import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
export const MAX_REPORT_BYTES = 1024 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedKeys = new Set([
  "schemaVersion",
  "scaleMode",
  "id",
  "kind",
  "startedAt",
  "endedAt",
  "build",
  "userAgent",
  "device",
  "observations",
  "rating",
  "capabilities",
  "metrics",
  "capture",
  "camera",
  "wasm",
  "motionPermission",
  "notes",
  "stopReason",
  "tracking",
  "features",
  "model",
  "events",
  "errors",
  "synthetic",
  "viewport",
  "physicalEvidence",
  "outcome",
]);
export function validateReport(value) {
  if (
    !value ||
    Array.isArray(value) ||
    typeof value !== "object" ||
    value.schemaVersion !== 2 ||
    !uuid.test(value.id) ||
    ![
      "viewer-3d",
      "model-webxr",
      "webxr",
      "capture",
      "patch",
      "tabletop",
      "diagnostic",
      "synthetic",
      "synthetic-tabletop",
    ].includes(value.kind)
  )
    throw Error("Invalid report envelope");
  if (
    (value.synthetic != null && typeof value.synthetic !== "boolean") ||
    (value.synthetic === true && !["synthetic", "synthetic-tabletop"].includes(value.kind)) ||
    (value.kind === "synthetic-tabletop" && value.synthetic !== true)
  )
    throw Error("Synthetic replay must remain explicitly identified");
  if (Object.keys(value).some((k) => !allowedKeys.has(k))) throw Error("Unknown report field");
  if (value.physicalEvidence !== false || value.outcome !== "unreviewed")
    throw Error("Reports cannot assert physical qualification");
  if (
    typeof value.userAgent !== "string" ||
    value.userAgent.length > 1000 ||
    typeof value.observations !== "string" ||
    value.observations.length > 4000
  )
    throw Error("Invalid report text");
  if (value.scaleMode != null && !["assumed", "metric", "unknown"].includes(value.scaleMode))
    throw Error("Invalid scale mode");
  // Only structured numeric/text diagnostics. Camera media/credentials are never accepted.
  const visit = (v, depth = 0, path = "") => {
    if (depth > 12) throw Error("Report too deeply nested");
    if (
      typeof v === "string" &&
      (v.length > 6000 || /data:[^,]*;base64|-----BEGIN .*PRIVATE KEY/i.test(v))
    )
      throw Error("Media/credentials are not accepted");
    if (typeof v === "number" && !Number.isFinite(v)) throw Error("Non-finite number");
    if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v)) {
        // capture.luma is the two-number processing resolution, never a pixel buffer.
        const dimensions =
          path === "capture" &&
          k === "luma" &&
          Array.isArray(x) &&
          x.length === 2 &&
          x.every((n) => Number.isInteger(n) && n > 0 && n <= 16384);
        if (
          !dimensions &&
          /^(frames|images|video|audio|pixels|rgba|luma|token|cookie|authorization|password|__proto__|constructor|prototype)$/i.test(
            k,
          ) &&
          !(k === "frames" && Number.isInteger(x) && x >= 0)
        )
          throw Error("Forbidden report payload");
        if (Array.isArray(x) && x.length > 2000) throw Error("Diagnostic array too long");
        visit(x, depth + 1, path ? `${path}.${k}` : k);
      }
  };
  visit(value);
  return value;
}
export async function storeReport(directory, report, build) {
  validateReport(report);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `${report.id}.json`);
  const record = { receivedAt: new Date().toISOString(), serverBuild: build, report };
  try {
    await writeFile(path, JSON.stringify(record, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const existing = JSON.parse(await readFile(path, "utf8"));
    if (JSON.stringify(existing.report) !== JSON.stringify(report))
      throw Error("Report ID already used with different content");
  }
  return { id: report.id, receipt: `SP-${report.id.slice(0, 8).toUpperCase()}`, saved: true };
}
