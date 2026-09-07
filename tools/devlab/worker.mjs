import { TrackingSession } from "./patch.mjs";
import { MAX_PIXELS } from "./tracking-math.mjs";
let kernel, canvas, context, tracker, width, height;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === "init") {
      width = data.width ?? 640;
      height = data.height ?? 360;
      // Native luma.cpp owns fixed 640*360 buffers; enforce before memory views.
      if (
        ![width, height].every((v) => Number.isInteger(v) && v > 0 && v <= 640) ||
        width * height > MAX_PIXELS
      )
        throw Error("Processing dimensions exceed WASM capacity");
      const response = await fetch(data.wasmUrl);
      if (!response.ok) throw Error(`WASM HTTP ${response.status}; run npm run build:wasm`);
      const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), {});
      kernel = instance.exports;
      kernel._initialize?.();
      canvas = new OffscreenCanvas(width, height);
      context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw Error("Worker 2D canvas unavailable");
      tracker = new TrackingSession(width, height);
      self.postMessage({
        type: "ready",
        width,
        height,
        simd: !!kernel.is_simd(),
        trackProcessorWorker: typeof MediaStreamTrackProcessor === "function",
      });
    } else if (data.type === "reset") {
      if (tracker) tracker = new TrackingSession(width, height);
    } else if (data.type === "motion") {
      tracker?.motion(data.samples ?? []);
    } else if (data.type === "place") {
      tracker?.place(data.point);
    } else if (data.type === "frame") {
      const started = performance.now();
      let rgba;
      try {
        if (!kernel || !tracker) throw Error("Worker is not initialized");
        if (data.bitmap) {
          // Caller dimensions preserve the source aspect. Drawing may downsample,
          // but must never silently squeeze portrait into a landscape rectangle.
          if (Math.abs(data.bitmap.width / data.bitmap.height - width / height) > 0.01)
            throw Error("Camera aspect changed; restart tracking");
          context.drawImage(data.bitmap, 0, 0, width, height);
          rgba = context.getImageData(0, 0, width, height).data;
        } else rgba = new Uint8Array(data.rgba);
      } finally {
        data.bitmap?.close();
      }
      if (rgba.length !== width * height * 4) throw Error("Unexpected frame byte length");
      new Uint8Array(kernel.memory.buffer, kernel.input(), rgba.length).set(rgba);
      const checksum = kernel.process(width * height);
      const luma = new Uint8Array(kernel.memory.buffer, kernel.output(), width * height);
      const tracking = data.patch ? tracker.frame(luma, data.sent) : null;
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
