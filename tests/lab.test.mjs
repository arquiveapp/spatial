import test from "node:test";
import assert from "node:assert/strict";
import { stats, Metrics } from "../tools/devlab/metrics.mjs";
import { PlanarPatch, identity, integrate } from "../tools/devlab/patch.mjs";
test("empty metrics are unknown; dropped runs count bursts", () => {
  assert.equal(stats([]).p95, null);
  assert.equal(stats([1, 2, 3]).mean, 2);
  const m = new Metrics();
  m.drop();
  m.drop();
  m.frame(4, 5);
  m.drop();
  assert.equal(m.dropped, 3);
  assert.equal(m.bursts, 2);
});
test("gyro integration rejects gaps and produces an orthonormal rotation", () => {
  const R = integrate(identity(), { alpha: 10, beta: 20, gamma: 30 }, 0.016);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      const dot = R.slice(i * 3, i * 3 + 3).reduce((s, v, k) => s + v * R[j * 3 + k], 0);
      assert(Math.abs(dot - (i === j ? 1 : 0)) < 1e-10);
    }
  assert.deepEqual(integrate(identity(), { alpha: 10, beta: 0, gamma: 0 }, 1), identity());
});
function texture(dx = 0) {
  return Uint8Array.from({ length: 640 * 360 }, (_, i) => {
    const x = (i % 640) - dx,
      y = Math.floor(i / 640);
    return 128 + 45 * Math.sin(x * 0.4) + 35 * Math.sin(y * 0.37) + 30 * Math.cos((x + y) * 0.24);
  });
}
test("patch refuses blank images and absent gravity", () => {
  const p = new PlanarPatch();
  assert.equal(p.place(texture(), 320, 180, null).reason, "gravity-unavailable");
  assert.equal(
    p.place(new Uint8Array(640 * 360), 320, 180, { x: 0, y: 0, z: -9.8 }).reason,
    "insufficient-texture",
  );
});
test("synthetic textured plane recovers a small translation in relative units", () => {
  const p = new PlanarPatch();
  assert.equal(p.place(texture(), 320, 180, { x: 0, y: 0, z: -9.8 }).state, "tracking");
  const still = p.track(texture(), identity());
  assert.equal(still.state, "tracking");
  assert(Math.hypot(...still.translationOverDistance) < 1e-5);
  const shifted = p.track(texture(2), identity());
  assert.equal(shifted.state, "tracking");
  assert(Math.abs(shifted.screen[0] - 322) < 0.3);
  assert.equal(shifted.scaleMode, "assumed");
  p.place(texture(), 320, 180, null);
  assert.equal(p.track(texture(), identity()).state, "lost");
});
