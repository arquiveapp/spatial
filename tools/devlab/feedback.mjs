// Measurement drafts are local until the tester explicitly sends or downloads one.
const KEY = "spatial-lab-draft-v2";
const events = [],
  errors = [];
function cleanText(text, max = 2000) {
  return String(text)
    .replace(/\/join\/[a-f0-9]+/g, "/join/[redacted]")
    .slice(0, max);
}
export function recordEvent(type, detail = {}) {
  events.push({ at: new Date().toISOString(), type, detail });
  if (events.length > 300) events.shift();
}
window.addEventListener("error", (e) => {
  errors.push({ type: "error", message: cleanText(e.message) });
  if (errors.length > 30) errors.shift();
});
window.addEventListener("unhandledrejection", (e) => {
  errors.push({ type: "rejection", message: cleanText(e.reason?.message ?? e.reason) });
  if (errors.length > 30) errors.shift();
});
export function restoreDraft() {
  try {
    return JSON.parse(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}
export function makeReport(base, { build, device, observations, rating, id }) {
  const metrics = base?.metrics
    ? {
        ...base.metrics,
        trace: (base.metrics.trace ?? [])
          .filter(
            (_, i, a) => i % Math.max(1, Math.ceil(a.length / 300)) === 0 || i === a.length - 1,
          )
          .slice(-300),
      }
    : null;
  const result = {
    ...base,
    schemaVersion: 2,
    id: id ?? crypto.randomUUID(),
    kind: base?.kind ?? "diagnostic",
    build,
    userAgent: navigator.userAgent,
    device,
    observations: observations.slice(0, 4000),
    rating,
    events: [...(Array.isArray(base?.events) ? base.events : []), ...events].slice(-300),
    errors: [...(Array.isArray(base?.errors) ? base.errors : []).slice(-30), ...errors].map(
      (error) => ({
        type: cleanText(error?.type ?? error?.name ?? "error", 100),
        message: cleanText(error?.message ?? error),
      }),
    ),
    metrics,
    viewport: { width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio },
    physicalEvidence: false,
    outcome: "unreviewed",
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(result));
  } catch {
    /* Download/send still work if private-mode storage is full. */
  }
  return result;
}
export async function submitReport(report) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch("/api/results", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-Spatial-Report": "1" },
      body: JSON.stringify(report),
      signal: controller.signal,
    });
    let result;
    try {
      result = await response.json();
    } catch {
      throw Error(
        "O endereço de teste não respondeu. Baixe o JSON ou reabra o link completo e tente novamente.",
      );
    }
    if (!response.ok) throw Error(result.error ?? `HTTP ${response.status}`);
    if (
      !result.saved ||
      result.id !== report.id ||
      result.receipt !== `SP-${report.id.slice(0, 8).toUpperCase()}`
    )
      throw Error("O Mac não confirmou o recibo. Tente novamente ou baixe o JSON.");
    return result;
  } catch (error) {
    if (controller.signal.aborted)
      throw Error(
        "O envio demorou demais. Tente novamente; o mesmo resultado não será duplicado. Você também pode baixar o JSON.",
      );
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
export function downloadReport(report) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `spatial-${report.id.slice(0, 8)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
