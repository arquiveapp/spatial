import test from "node:test";
import assert from "node:assert/strict";
import { probe } from "../packages/core/dist/index.js";
async function withGlobals(values, fn) {
  const old = new Map(
    Object.keys(values).map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]),
  );
  try {
    for (const [k, v] of Object.entries(values))
      Object.defineProperty(globalThis, k, { value: v, configurable: true });
    await fn();
  } finally {
    for (const [k, v] of old)
      if (v) Object.defineProperty(globalThis, k, v);
      else delete globalThis[k];
  }
}
test("SSR is inert and never claims support", async () => {
  const r = await probe();
  assert.equal(r.support, "untested");
  assert.equal(r.camera, "unavailable");
  assert.equal(r.webxr.immersiveAr, false);
});
test("probe checks immersive-ar without opening camera or requesting permissions", async () => {
  let checked = 0;
  await withGlobals(
    {
      isSecureContext: true,
      navigator: {
        mediaDevices: {
          getUserMedia() {
            throw Error("prompt forbidden");
          },
        },
        xr: {
          async isSessionSupported(mode) {
            assert.equal(mode, "immersive-ar");
            checked++;
            return true;
          },
        },
      },
      DeviceMotionEvent: {
        requestPermission() {
          throw Error("prompt forbidden");
        },
      },
    },
    async () => {
      const r = await probe();
      assert.equal(r.camera, "available");
      assert.equal(r.webxr.immersiveAr, true);
      assert.equal(r.motion.permissionRequired, true);
      assert.equal(checked, 1);
    },
  );
});
test("policy blocking and rejected XR probes remain distinct from lack of support", async () => {
  await withGlobals(
    {
      isSecureContext: true,
      navigator: {
        mediaDevices: { getUserMedia() {} },
        xr: {
          async isSessionSupported() {
            throw Error("denied");
          },
        },
      },
      document: { permissionsPolicy: { features: () => ["camera"], allowsFeature: () => false } },
    },
    async () => {
      const r = await probe();
      assert.equal(r.camera, "policy-blocked");
      assert.equal(r.webxr.immersiveAr, "unknown");
      assert.equal(r.webxr.reason, "probe-rejected");
    },
  );
});
