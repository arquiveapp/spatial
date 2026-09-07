import test from "node:test";
import assert from "node:assert/strict";
import { PlanarPatch, TrackingSession, identity, integrate } from "../tools/devlab/patch.mjs";
import { processingSize, MAX_PIXELS } from "../tools/devlab/tracking-math.mjs";
const texture = (w, h, dx = 0, dy = 0) =>
  Uint8Array.from({ length: w * h }, (_, i) => {
    const x = (i % w) - dx,
      y = Math.floor(i / w) - dy;
    return 128 + 45 * Math.sin(x * 0.4) + 35 * Math.sin(y * 0.37) + 30 * Math.cos((x + y) * 0.24);
  });
const transform = (matrix, v) =>
  Array.from({ length: 4 }, (_, row) =>
    v.reduce((sum, n, col) => sum + matrix[col * 4 + row] * n, 0),
  );
function projectedAnchor(result) {
  const world = transform(result.anchorMatrix, [0, 0, 0, 1]);
  const view = transform(result.viewMatrix, world);
  const clip = transform(result.projectionMatrix, view);
  return [
    ((clip[0] / clip[3] + 1) * result.width) / 2,
    ((1 - clip[1] / clip[3]) * result.height) / 2,
  ];
}
const gravity = { x: 0, y: 0, z: 9.8 };
test("processing dimensions preserve portrait, landscape and square within native capacity", () => {
  assert.deepEqual(processingSize(720, 1280), [360, 640]);
  assert.deepEqual(processingSize(1280, 720), [640, 360]);
  for (const [w, h] of [
    [1920, 1080],
    [1080, 1920],
    [1000, 1000],
    [4032, 3024],
  ]) {
    const [x, y] = processingSize(w, h);
    assert(x * y <= MAX_PIXELS && Math.max(x, y) <= 640);
    assert(Math.abs(x / y - w / h) < 0.005);
  }
  assert.throws(() => processingSize(0, 100));
});
test("gyro optical scene rotation obeys W3C device axes and passive-camera sign", () => {
  const beta = integrate(identity(), { alpha: 0, beta: 90, gamma: 0 }, 0.1);
  assert(beta[5] > 0 && beta[7] < 0);
  const gamma = integrate(identity(), { alpha: 0, beta: 0, gamma: 90 }, 0.1);
  assert(gamma[2] > 0 && gamma[6] < 0);
  const alpha = integrate(identity(), { alpha: 90, beta: 0, gamma: 0 }, 0.1);
  assert(alpha[1] < 0 && alpha[3] > 0);
});
test("portrait replay produces real 3D matrices matching tracked patch pixels", () => {
  const patch = new PlanarPatch(360, 640);
  let result = patch.place(texture(360, 640), 150, 320, gravity);
  assert.equal(result.state, "tracking");
  assert.equal(result.scaleMode, "assumed");
  for (let displacement = 0; displacement <= 8; displacement += 2) {
    result = patch.track(texture(360, 640, displacement), identity());
    assert.equal(result.state, "tracking");
    assert(Math.abs(result.screen[0] - (150 + displacement)) < 0.3);
    const screen = projectedAnchor(result);
    assert(Math.hypot(screen[0] - result.screen[0], screen[1] - result.screen[1]) < 1e-7);
    assert(
      [...result.viewMatrix, ...result.projectionMatrix, ...result.anchorMatrix].every(
        Number.isFinite,
      ),
    );
  }
  const lost = patch.track(new Uint8Array(360 * 640), identity());
  assert.equal(lost.state, "lost");
  assert.equal(lost.viewMatrix, undefined);
});
test("tilted plane anchor is right handed and matches gyro-rotated optical projection", () => {
  const patch = new PlanarPatch(360, 640);
  patch.place(texture(360, 640), 190, 390, { x: 0, y: 6.93, z: 6.93 });
  const R = integrate(identity(), { alpha: 12, beta: 4, gamma: 6 }, 0.02);
  patch.t = [0.01, -0.02, 0.03];
  const result = patch.result(R, 0, 100),
    screen = projectedAnchor(result);
  assert(Math.hypot(screen[0] - result.screen[0], screen[1] - result.screen[1]) < 1e-7);
  const m = result.anchorMatrix,
    x = m.slice(0, 3),
    y = m.slice(4, 7),
    z = m.slice(8, 11);
  assert(
    Math.abs(
      x[0] * (y[1] * z[2] - y[2] * z[1]) -
        x[1] * (y[0] * z[2] - y[2] * z[0]) +
        x[2] * (y[0] * z[1] - y[1] * z[0]) -
        1,
    ) < 1e-9,
  );
});
test("tap waits for sensor warmup; transient null rates do not erase valid sensors", () => {
  const session = new TrackingSession(360, 640),
    im = texture(360, 640);
  session.place([0.5, 0.5]);
  assert.equal(session.frame(im, 100).state, "initializing");
  session.motion([
    { time: 120, rate: { alpha: 0, beta: 0, gamma: 0 }, gravity },
    { time: 125, rate: null, gravity: null },
  ]);
  const placed = session.frame(im, 130);
  assert.equal(placed.state, "tracking");
  assert.equal(placed.motionAgeMs, 10);
  assert.equal(session.frame(im, 600).state, "lost");
  session.motion([{ time: 620, rate: { alpha: 0, beta: 0, gamma: 0 }, gravity }]);
  assert.equal(session.frame(im, 630).reason, "sensor-gap-reposition");
  session.place([0.5, 0.5]);
  assert.equal(session.frame(im, 640).state, "tracking");
});
test("sensor permission/data absence expires pending tap and loss requires honest reposition", () => {
  const session = new TrackingSession(360, 640),
    im = texture(360, 640);
  session.place([0.5, 0.5]);
  session.frame(im, 100);
  assert.equal(session.frame(im, 2201).reason, "sensor-permission-or-data-unavailable");
  assert.equal(session.frame(im, 2300).state, "unplaced");
  session.motion([{ time: 2310, rate: { alpha: 0, beta: 0, gamma: 0 }, gravity }]);
  session.place([0.5, 0.5]);
  assert.equal(session.frame(im, 2320).state, "tracking");
  const blank = new Uint8Array(360 * 640);
  for (let i = 0; i < 3; i++) assert.equal(session.frame(blank, 2330 + i * 10).state, "lost");
  assert.equal(session.frame(im, 2360).state, "unplaced");
  session.place([0.5, 0.5]);
  assert.equal(session.frame(im, 2370).state, "tracking");
});

test("synthetic tilted-plane image replay fits gyro rotation plus camera translation", () => {
  const patch = new PlanarPatch(360, 640),
    w = 360,
    h = 640;
  assert.equal(patch.place(texture(w, h), 180, 360, { x: 0, y: 5.6, z: 8 }).state, "tracking");
  const R = integrate(identity(), { alpha: 8, beta: 7, gamma: 10 }, 0.03),
    t = [0.008, -0.003, 0.002];
  const H = R.map((v, i) => v + t[Math.floor(i / 3)] * patch.normal[i % 3]);
  const [a, b, c, d, e, f, g, k, l] = H;
  const adj = [
    e * l - f * k,
    c * k - b * l,
    b * f - c * e,
    f * g - d * l,
    a * l - c * g,
    c * d - a * f,
    d * k - e * g,
    b * g - a * k,
    a * e - b * d,
  ];
  const det = a * adj[0] + b * adj[3] + c * adj[6],
    inv = adj.map((v) => v / det);
  const image = Uint8Array.from({ length: w * h }, (_, i) => {
    const x = ((i % w) - w / 2) / patch.f,
      y = (Math.floor(i / w) - h / 2) / patch.f;
    const z = inv[6] * x + inv[7] * y + inv[8];
    const u = ((inv[0] * x + inv[1] * y + inv[2]) / z) * patch.f + w / 2;
    const v = ((inv[3] * x + inv[4] * y + inv[5]) / z) * patch.f + h / 2;
    return 128 + 45 * Math.sin(u * 0.4) + 35 * Math.sin(v * 0.37) + 30 * Math.cos((u + v) * 0.24);
  });
  const result = patch.track(image, R);
  assert.equal(result.state, "tracking");
  const expected = patch.project(...patch.center, R, t);
  assert(Math.hypot(result.screen[0] - expected[0], result.screen[1] - expected[1]) < 0.4);
  const projected = projectedAnchor(result);
  assert(Math.hypot(projected[0] - expected[0], projected[1] - expected[1]) < 0.4);
});
