import { probe } from "/packages/core/dist/index.js";
import { Metrics } from "./metrics.mjs";
import { processingSize } from "./tracking-math.mjs";
import { containedRect } from "./video-rect.mjs";
import { startXR } from "./webxr.mjs";
const $ = (id) => document.getElementById(id),
  status = (text) => {
    $("status").textContent = text;
    window.dispatchEvent(new CustomEvent("spatial-lab-status", { detail: { message: text } }));
  };
let active = null,
  report = null,
  capabilities = null;
const build = await fetch("/lab-build.json").then((r) => r.json());
const buttons = ["synthetic", "probe", "xr", "capture", "patch"];
function render() {
  if (report)
    $("output").textContent = JSON.stringify(
      {
        ...report,
        metrics: report.metrics
          ? {
              ...report.metrics,
              trace: `${report.metrics.trace.length} pose samples (included in export)`,
            }
          : null,
      },
      null,
      2,
    );
}
function stop(reason = "Stopped") {
  const run = active;
  if (!run) return;
  active = null;
  run.controller.abort();
  run.worker?.terminate();
  run.stream?.getTracks().forEach((t) => t.stop());
  if (run.callback !== null) {
    if (run.rvfc) $("video").cancelVideoFrameCallback(run.callback);
    else cancelAnimationFrame(run.callback);
  }
  clearInterval(run.interval);
  clearInterval(run.motionTimer);
  clearTimeout(run.timeout);
  $("video").pause();
  $("video").srcObject = null;
  $("preview").classList.remove("active");
  $("marker").hidden = true;
  if (run.metrics) report.metrics = run.metrics.snapshot();
  report.endedAt = new Date().toISOString();
  report.stopReason = reason;
  report.outcome = "unreviewed";
  $("stop").disabled = true;
  $("export").disabled = false;
  buttons.forEach((id) => ($(id).disabled = false));
  status(reason);
  render();
  window.dispatchEvent(new CustomEvent("spatial-lab-finished", { detail: report }));
}
function begin(kind) {
  stop();
  window.dispatchEvent(new CustomEvent("spatial-lab-start", { detail: { kind } }));
  const run = {
    controller: new AbortController(),
    kind,
    callback: null,
    worker: null,
    stream: null,
    metrics: new Metrics(),
    busy: false,
    samples: [],
  };
  active = run;
  report = {
    schemaVersion: 1,
    kind,
    startedAt: new Date().toISOString(),
    build,
    userAgent: navigator.userAgent,
    capabilities,
    physicalEvidence: false,
    outcome: "unreviewed",
    scaleMode: kind === "webxr" ? "metric" : "assumed",
    metrics: null,
    notes: [],
  };
  buttons.forEach((id) => ($(id).disabled = true));
  $("stop").disabled = false;
  $("export").disabled = true;
  status("Requesting access…");
  return run;
}
$("probe").onclick = async () => {
  try {
    capabilities = await probe();
    $("output").textContent = JSON.stringify(capabilities, null, 2);
    status("Detection complete. API presence is not device support.");
  } catch (e) {
    status(`Detection failed: ${e.message}`);
  }
};
$("stop").onclick = () => stop();
async function capture(patch) {
  const run = begin(patch ? "patch" : "capture"),
    signal = run.controller.signal;
  // Both requests are initiated synchronously from this click, before awaiting either.
  let motionPromise, cameraPromise;
  try {
    motionPromise =
      typeof globalThis.DeviceMotionEvent?.requestPermission === "function"
        ? globalThis.DeviceMotionEvent.requestPermission()
        : Promise.resolve("not-required");
  } catch (e) {
    motionPromise = Promise.reject(e);
  }
  try {
    cameraPromise = navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });
  } catch (e) {
    cameraPromise = Promise.reject(e);
  }
  // Release late camera fulfillment even if permission UI outlives Stop.
  cameraPromise.then(
    (s) => {
      if (signal.aborted) s.getTracks().forEach((t) => t.stop());
      else run.stream = s;
    },
    () => {},
  );
  try {
    const [camera, motion] = await Promise.allSettled([cameraPromise, motionPromise]);
    if (signal.aborted) return;
    report.motionPermission = motion.status === "fulfilled" ? motion.value : motion.reason.name;
    if (camera.status === "rejected") throw camera.reason;
    const video = $("video");
    video.srcObject = camera.value;
    await video.play();
    if (signal.aborted) return;
    const settings = camera.value.getVideoTracks()[0].getSettings();
    report.camera = {
      width: settings.width,
      height: settings.height,
      frameRate: settings.frameRate,
      facingMode: settings.facingMode,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
    };
    const [width, height] = processingSize(video.videoWidth, video.videoHeight);
    report.capture = {
      path:
        typeof createImageBitmap === "function"
          ? "rvfc-imagebitmap-worker-canvas"
          : "rvfc-main-canvas",
      requested: [1280, 720],
      luma: [width, height],
      pixelFormat: "RGBA canvas readback",
      captureTimeAvailable: false,
      preferredTrackProcessorPath: "not-implemented-in-this-spike",
    };
    const worker = new Worker(new URL("./worker.mjs", import.meta.url), { type: "module" });
    run.worker = worker;
    let variant = "simd";
    const initialise = () =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error("Worker initialization timeout")), 15000);
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(Error("Experiment cancelled"));
          },
          { once: true },
        );
        worker.onerror = (e) => {
          clearTimeout(timer);
          reject(Error(e.message));
        };
        worker.onmessage = ({ data }) => {
          if (data.type === "ready") {
            clearTimeout(timer);
            resolve(data);
          } else if (data.type === "error") {
            clearTimeout(timer);
            reject(Error(data.message));
          }
        };
        worker.postMessage({
          type: "init",
          width,
          height,
          wasmUrl: new URL(`./generated/luma.${variant}.wasm`, import.meta.url).href,
        });
      });
    let info;
    try {
      info = await initialise();
    } catch (error) {
      if (signal.aborted) throw error;
      report.notes.push(
        `SIMD initialization failed: ${error.message}; explicit base diagnostic used`,
      );
      variant = "base";
      info = await initialise();
    }
    if (signal.aborted) return;
    report.wasm = { variant, ...info };
    run.metrics.reset();
    $("preview").classList.add("active");
    const motionHandler = (e) => {
      const now = performance.now(),
        rate = e.rotationRate,
        hasGyro = rate && [rate.alpha, rate.beta, rate.gamma].every(Number.isFinite);
      run.metrics.motion(now, hasGyro);
      if (run.samples.length < 64)
        run.samples.push({
          time: now,
          rate: hasGyro ? { alpha: rate.alpha, beta: rate.beta, gamma: rate.gamma } : null,
          gravity: e.accelerationIncludingGravity
            ? {
                x: e.accelerationIncludingGravity.x,
                y: e.accelerationIncludingGravity.y,
                z: e.accelerationIncludingGravity.z,
              }
            : null,
        });
    };
    window.addEventListener("devicemotion", motionHandler, { signal });
    run.motionTimer = setInterval(() => {
      if (run.samples.length) {
        worker.postMessage({ type: "motion", samples: run.samples });
        run.samples = [];
      }
    }, 16);
    worker.onerror = (e) => {
      if (active === run) stop(`Worker failed: ${e.message}`);
    };
    worker.onmessage = ({ data }) => {
      if (signal.aborted) return;
      if (data.type === "error") {
        stop(`Worker failed: ${data.message}`);
        return;
      }
      if (data.type !== "frame") return;
      run.busy = false;
      clearTimeout(run.timeout);
      run.metrics.frame(data.ms, performance.now() - data.sent);
      if (data.tracking) {
        const t = data.tracking;
        report.tracking = t;
        if (run.metrics.trace.length < 36000)
          run.metrics.trace.push({ time: performance.now() - run.metrics.started, ...t });
        const marker = $("marker");
        marker.hidden = t.state !== "tracking" || !t.screen;
        if (!marker.hidden) {
          const content = containedRect(
            video.getBoundingClientRect(),
            video.videoWidth,
            video.videoHeight,
          );
          const box = $("preview").getBoundingClientRect();
          marker.style.left = `${content.left - box.left + (t.screen[0] / width) * content.width}px`;
          marker.style.top = `${content.top - box.top + (t.screen[1] / height) * content.height}px`;
        }
        status(
          t.state === "tracking"
            ? "Patch fit active — assumed scale, unvalidated gyro axes."
            : `Patch: ${t.reason ?? t.state}`,
        );
      }
    };
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    run.rvfc = typeof video.requestVideoFrameCallback === "function";
    let previousTime = -1,
      previousPresented = null;
    const schedule = () => {
      if (!signal.aborted)
        run.callback = run.rvfc
          ? video.requestVideoFrameCallback(frame)
          : requestAnimationFrame(frame);
    };
    const frame = async (now, meta) => {
      if (signal.aborted) return;
      schedule();
      if (!run.rvfc && video.currentTime === previousTime) return;
      previousTime = video.currentTime;
      if (meta?.presentedFrames !== undefined) {
        if (previousPresented !== null && meta.presentedFrames > previousPresented + 1)
          for (let i = previousPresented + 1; i < meta.presentedFrames; i++) run.metrics.drop();
        previousPresented = meta.presentedFrames;
      }
      if (meta?.captureTime !== undefined) {
        run.metrics.captureTimeSamples++;
        report.capture.captureTimeAvailable = true;
      }
      if (run.busy) {
        run.metrics.drop();
        return;
      }
      run.busy = true;
      const sent = performance.now();
      run.timeout = setTimeout(() => stop("Frame processing timeout"), 5000);
      try {
        if (typeof createImageBitmap === "function") {
          const bitmap = await createImageBitmap(video);
          if (signal.aborted) {
            bitmap.close();
            return;
          }
          worker.postMessage({ type: "frame", bitmap, sent, patch }, [bitmap]);
        } else {
          context.drawImage(video, 0, 0, width, height);
          const rgba = context.getImageData(0, 0, width, height).data.buffer;
          worker.postMessage({ type: "frame", rgba, sent, patch }, [rgba]);
        }
      } catch (e) {
        if (active === run) stop(`Capture failed: ${e.message}`);
      }
    };
    video.addEventListener(
      "click",
      (e) => {
        if (patch) {
          const b = containedRect(
            video.getBoundingClientRect(),
            video.videoWidth,
            video.videoHeight,
          );
          if (
            e.clientX < b.left ||
            e.clientX > b.left + b.width ||
            e.clientY < b.top ||
            e.clientY > b.top + b.height
          )
            return;
          worker.postMessage({
            type: "place",
            point: [(e.clientX - b.left) / b.width, (e.clientY - b.top) / b.height],
          });
        }
      },
      { signal },
    );
    camera.value
      .getVideoTracks()[0]
      .addEventListener("ended", () => stop("Camera track ended"), { signal });
    video.addEventListener("resize", () => stop("Camera dimensions changed; restart required"), {
      signal,
    });
    run.interval = setInterval(() => {
      report.metrics = run.metrics.snapshot();
      render();
    }, 1000);
    schedule();
    status(
      patch
        ? "Tap a textured horizontal patch; hold still for the gravity prior."
        : "Capture running. Record at least five minutes; stop to export.",
    );
  } catch (e) {
    if (active === run) stop(`Start failed: ${e.name}: ${e.message}`);
  }
}
$("capture").onclick = () => capture(false);
$("patch").onclick = () => capture(true);
$("xr").onclick = async () => {
  const run = begin("webxr");
  try {
    const xr = await startXR(
      $("xr-canvas"),
      $("overlay"),
      run.controller.signal,
      (text) => {
        if (active === run) {
          status(text);
          if (text === "XR session ended") stop(text);
        }
      },
      (frame) => {
        if (run.metrics.trace.length < 36000) run.metrics.trace.push(frame);
      },
    );
    if (active === run) {
      report.features = xr.features;
      run.interval = setInterval(() => {
        report.metrics = run.metrics.snapshot();
        render();
      }, 1000);
    }
  } catch (e) {
    if (active === run) stop(`WebXR failed: ${e.name}: ${e.message}`);
  }
};
window.addEventListener("pagehide", () => stop("Page hidden"));
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stop("Backgrounded; restart required");
});
window.addEventListener("orientationchange", () => stop("Orientation changed; restart required"));
screen.orientation?.addEventListener("change", () => stop("Orientation changed; restart required"));
// Explicit synthetic browser check: no device data, camera or support evidence.
$("synthetic").onclick = async () => {
  const button = $("synthetic");
  button.disabled = true;
  const results = [];
  try {
    for (const variant of ["base", "simd"]) {
      const worker = new Worker(new URL("./worker.mjs", import.meta.url), { type: "module" });
      try {
        const request = (data, transfer = []) =>
          new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(Error("Synthetic worker timeout")), 10000);
            worker.onerror = (e) => {
              clearTimeout(timer);
              reject(Error(e.message));
            };
            worker.onmessage = ({ data: reply }) => {
              clearTimeout(timer);
              reply.type === "error" ? reject(Error(reply.message)) : resolve(reply);
            };
            worker.postMessage(data, transfer);
          });
        const ready = await request({
          type: "init",
          wasmUrl: new URL(`./generated/luma.${variant}.wasm`, import.meta.url).href,
        });
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 360;
        const context = canvas.getContext("2d");
        context.fillStyle = "rgb(255,0,0)";
        context.fillRect(0, 0, 640, 360);
        const bitmap = await createImageBitmap(canvas);
        const result = await request(
          { type: "frame", bitmap, sent: performance.now(), patch: false },
          [bitmap],
        );
        if (result.checksum !== 76 * 640 * 360 || ready.simd !== (variant === "simd"))
          throw Error(`Unexpected ${variant} output`);
        results.push({ variant, checksum: result.checksum, workerMs: result.ms, result: "pass" });
      } finally {
        worker.terminate();
      }
    }
    $("output").textContent = JSON.stringify(
      { kind: "synthetic-browser-check", physicalEvidence: false, results },
      null,
      2,
    );
    status("Synthetic base + SIMD Worker checks passed. No physical device evidence.");
  } catch (e) {
    status(`Synthetic check failed: ${e.message}`);
  } finally {
    button.disabled = false;
  }
};

export function getLabReport() {
  return report
    ? { ...report, metrics: active?.metrics ? active.metrics.snapshot() : report.metrics }
    : null;
}
export function stopLab() {
  stop("Teste encerrado pelo usuário");
}
