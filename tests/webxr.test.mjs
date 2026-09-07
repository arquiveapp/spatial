import test from "node:test";
import assert from "node:assert/strict";
import { startXR } from "../tools/devlab/webxr.mjs";
function setup() {
  const counts = { end: 0, hit: 0, buffers: 0, programs: 0, shaders: 0, cancel: 0 };
  const gl = {
    makeXRCompatible: async () => {},
    createProgram: () => {
      counts.programs++;
      return {};
    },
    deleteProgram: () => counts.programs--,
    createBuffer: () => {
      counts.buffers++;
      return {};
    },
    deleteBuffer: () => counts.buffers--,
    createShader: () => {
      counts.shaders++;
      return {};
    },
    deleteShader: () => counts.shaders--,
    getShaderParameter: () => true,
    getProgramParameter: () => true,
  };
  for (const method of [
    "shaderSource",
    "compileShader",
    "attachShader",
    "linkProgram",
    "bindBuffer",
    "bufferData",
    "useProgram",
    "getAttribLocation",
    "enableVertexAttribArray",
    "vertexAttribPointer",
    "getUniformLocation",
  ])
    gl[method] = () => {};
  const session = new EventTarget();
  Object.assign(session, {
    requestReferenceSpace: async () => ({}),
    requestHitTestSource: async () => ({
      cancel() {
        counts.hit++;
      },
    }),
    updateRenderState() {},
    requestAnimationFrame() {
      return 1;
    },
    cancelAnimationFrame() {
      counts.cancel++;
    },
    end: async () => {
      counts.end++;
      session.dispatchEvent(new Event("end"));
    },
  });
  const canvas = new EventTarget();
  canvas.getContext = () => gl;
  canvas.classList = { add() {}, remove() {} };
  return { counts, session, canvas };
}
async function globals(xr, fn) {
  const oldNav = Object.getOwnPropertyDescriptor(globalThis, "navigator"),
    oldLayer = globalThis.XRWebGLLayer;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { xr } });
  globalThis.XRWebGLLayer = class {};
  try {
    await fn();
  } finally {
    if (oldNav) Object.defineProperty(globalThis, "navigator", oldNav);
    else delete globalThis.navigator;
    if (oldLayer) globalThis.XRWebGLLayer = oldLayer;
    else delete globalThis.XRWebGLLayer;
  }
}
test("20 mocked XR open/abort cycles release owned GPU and hit-test resources", async () => {
  for (let i = 0; i < 20; i++) {
    const { counts, session, canvas } = setup();
    const controller = new AbortController();
    await globals(
      {
        requestSession: async (mode, options) => {
          assert.equal(mode, "immersive-ar");
          assert.deepEqual(options.requiredFeatures, ["hit-test", "anchors"]);
          return session;
        },
      },
      async () => {
        await startXR(
          canvas,
          {},
          controller.signal,
          () => {},
          () => {},
        );
        controller.abort();
        controller.abort();
        assert.deepEqual(counts, {
          end: 1,
          hit: 1,
          buffers: 0,
          programs: 0,
          shaders: 0,
          cancel: 1,
        });
      },
    );
  }
});
test("late XR session fulfillment after cancellation is immediately ended", async () => {
  const { counts, session, canvas } = setup();
  const controller = new AbortController();
  let resolve;
  await globals(
    {
      requestSession: () =>
        new Promise((r) => {
          resolve = r;
        }),
    },
    async () => {
      const pending = startXR(
        canvas,
        {},
        controller.signal,
        () => {},
        () => {},
      );
      controller.abort();
      resolve(session);
      await assert.rejects(pending, /cancelled/);
      assert.equal(counts.end, 1);
      assert.equal(counts.buffers, 0);
    },
  );
});
test("XR denied permission does not allocate GPU resources or silently fall back", async () => {
  const { counts, canvas } = setup();
  await globals(
    {
      requestSession: async () => {
        throw new DOMException("Denied", "NotAllowedError");
      },
    },
    async () => {
      await assert.rejects(
        startXR(
          canvas,
          {},
          new AbortController().signal,
          () => {},
          () => {},
        ),
        { name: "NotAllowedError" },
      );
      assert.equal(counts.buffers, 0);
      assert.equal(counts.programs, 0);
    },
  );
});
