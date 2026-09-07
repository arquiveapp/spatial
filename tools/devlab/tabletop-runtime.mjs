// Lab lifecycle and geometry helpers: no browser access at import time.
import { processingSize } from "./tracking-math.mjs";
export class ResourceScope {
  disposed = false;
  cleanups = [];
  own(cleanup) {
    let called = false;
    const once = () => {
      if (called) return;
      called = true;
      cleanup();
    };
    if (this.disposed) once();
    else this.cleanups.push(once);
    return once;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const cleanup of this.cleanups.splice(0).reverse()) {
      try {
        cleanup();
      } catch {
        /* Continue releasing independent resources. */
      }
    }
  }
}
export function captureSize(width, height) {
  return processingSize(width, height);
}
export function trackedPoseValid(tracking) {
  return (
    tracking?.state === "tracking" &&
    ["viewMatrix", "projectionMatrix", "anchorMatrix"].every(
      (key) =>
        Array.isArray(tracking[key]) &&
        tracking[key].length === 16 &&
        tracking[key].every(Number.isFinite),
    )
  );
}
export function normalizedTap(x, y, rect) {
  if (
    !(rect.width > 0 && rect.height > 0) ||
    x < rect.left ||
    y < rect.top ||
    x > rect.left + rect.width ||
    y > rect.top + rect.height
  )
    return null;
  return [(x - rect.left) / rect.width, (y - rect.top) / rect.height];
}

// A permission prompt may outlive Stop; settle the caller without losing late cleanup.
export function waitUntilAbortedOrSettled(pending, signal) {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(new DOMException("Teste cancelado", "AbortError"));
    const finish = (handler, value) => {
      signal.removeEventListener("abort", aborted);
      handler(value);
    };
    Promise.resolve(pending).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    );
    if (signal.aborted) aborted();
    else signal.addEventListener("abort", aborted, { once: true });
  });
}

export function startVideoPlayback(video, signal, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let settled = false,
      playing = false;
    const events = ["loadedmetadata", "loadeddata", "canplay", "playing", "resize"];
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const event of events) video.removeEventListener(event, ready);
      video.removeEventListener("error", failed);
      signal.removeEventListener("abort", aborted);
      if (error) reject(error);
      else resolve();
    };
    const ready = () => {
      if (playing && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0)
        finish();
    };
    const failed = () => finish(Error("A câmera não conseguiu iniciar o vídeo. Reabra o teste."));
    const aborted = () => finish(new DOMException("Teste cancelado", "AbortError"));
    const timer = setTimeout(
      () =>
        finish(
          Error(
            "A câmera não entregou imagem em 15 segundos. Feche outros usos da câmera e reabra o teste.",
          ),
        ),
      timeoutMs,
    );
    if (signal.aborted) {
      aborted();
      return;
    }
    signal.addEventListener("abort", aborted, { once: true });
    for (const event of events) video.addEventListener(event, ready);
    video.addEventListener("error", failed);
    try {
      Promise.resolve(video.play()).then(() => {
        playing = true;
        ready();
      }, finish);
    } catch (error) {
      finish(error);
    }
  });
}
