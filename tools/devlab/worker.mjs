import { PlanarPatch, identity, integrate } from "./patch.mjs";
let kernel,
  canvas,
  context,
  patch,
  rotation = identity(),
  gravity,
  lastMotion = null,
  gyroAvailable = false,
  place = null;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === "init") {
      const response = await fetch(data.wasmUrl);
      if (!response.ok) throw Error(`WASM HTTP ${response.status}; run npm run build:wasm`);
      const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), {});
      kernel = instance.exports;
      kernel._initialize?.();
      canvas = new OffscreenCanvas(640, 360);
      context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw Error("Worker 2D canvas unavailable");
      patch = new PlanarPatch();
      self.postMessage({
        type: "ready",
        simd: !!kernel.is_simd(),
        trackProcessorWorker: typeof MediaStreamTrackProcessor === "function",
      });
    } else if (data.type === "motion") {
      for (const s of data.samples) {
        if (lastMotion !== null)
          rotation = integrate(rotation, s.rate, (s.time - lastMotion) / 1000);
        gyroAvailable = s.rate !== null;
        lastMotion = s.time;
        gravity = s.gravity;
      }
    } else if (data.type === "place") {
      place = data.point;
    } else if (data.type === "frame") {
      const started = performance.now();
      let rgba;
      try {
        if (data.bitmap) {
          context.drawImage(data.bitmap, 0, 0, 640, 360);
          rgba = context.getImageData(0, 0, 640, 360).data;
        } else rgba = new Uint8Array(data.rgba);
      } finally {
        data.bitmap?.close();
      }
      new Uint8Array(kernel.memory.buffer, kernel.input(), rgba.length).set(rgba);
      const checksum = kernel.process(640 * 360);
      let tracking = null;
      if (data.patch) {
        const luma = new Uint8Array(kernel.memory.buffer, kernel.output(), 640 * 360);
        if (!gyroAvailable || lastMotion === null || data.sent - lastMotion > 250) {
          tracking = { state: "lost", reason: "gyro-unavailable-or-stale" };
          patch.points = [];
          place = null;
        } else if (place) {
          tracking = patch.place(luma, place[0] * 640, place[1] * 360, gravity);
          rotation = identity();
          place = null;
        } else tracking = patch.track(luma, rotation);
      }
      self.postMessage({
        type: "frame",
        ms: performance.now() - started,
        checksum,
        tracking,
        sent: data.sent,
      });
    }
  } catch (error) {
    self.postMessage({ type: "error", message: error.message });
  }
};
