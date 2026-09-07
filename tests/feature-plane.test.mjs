// SPDX-License-Identifier: MIT
import { test } from "node:test";
import assert from "node:assert/strict";
import { FeaturePlane } from "../tools/devlab/feature-plane.mjs";
const width = 240,
  height = 320;
function texture() {
  let seed = 17;
  const knots = Array.from({ length: 35 * 45 }, () => {
    seed = (seed * 16807) % 2147483647;
    return 30 + (seed % 190);
  });
  return Uint8Array.from({ length: width * height }, (_, i) => {
    const x = (i % width) / 7,
      y = Math.floor(i / width) / 7,
      ix = Math.floor(x),
      iy = Math.floor(y),
      a = x - ix,
      b = y - iy;
    return (
      (knots[iy * 35 + ix] * (1 - a) + knots[iy * 35 + ix + 1] * a) * (1 - b) +
      (knots[(iy + 1) * 35 + ix] * (1 - a) + knots[(iy + 1) * 35 + ix + 1] * a) * b
    );
  });
}
function warp(source, h, gain = 1, offset = 0) {
  const [a, b, c, d, e, f, g, j, k] = h;
  const inv = [
    e * k - f * j,
    c * j - b * k,
    b * f - c * e,
    f * g - d * k,
    a * k - c * g,
    c * d - a * f,
    d * j - e * g,
    b * g - a * j,
    a * e - b * d,
  ];
  return Uint8Array.from({ length: source.length }, (_, i) => {
    const x = i % width,
      y = Math.floor(i / width),
      z = inv[6] * x + inv[7] * y + inv[8],
      u = (inv[0] * x + inv[1] * y + inv[2]) / z,
      v = (inv[3] * x + inv[4] * y + inv[5]) / z;
    if (u < 0 || v < 0 || u >= width - 1 || v >= height - 1) return 127;
    const ix = Math.floor(u),
      iy = Math.floor(v),
      ax = u - ix,
      ay = v - iy,
      n = iy * width + ix;
    return Math.max(
      0,
      Math.min(
        255,
        offset +
          gain *
            ((source[n] * (1 - ax) + source[n + 1] * ax) * (1 - ay) +
              (source[n + width] * (1 - ax) + source[n + width + 1] * ax) * ay),
      ),
    );
  });
}
function project(h, [x, y]) {
  const d = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / d, (h[3] * x + h[4] * y + h[5]) / d];
}
function assertGeometry(result, expected, tolerance = 1.2) {
  assert.equal(result.state, "tracking", result.reason);
  assert.ok(result.inliers >= 10);
  for (const point of [
    [60, 100],
    [180, 100],
    [180, 220],
    [60, 220],
    [120, 160],
  ]) {
    const a = project(result.homography, point),
      b = project(expected, point);
    assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < tolerance, `${a} != ${b}`);
  }
}
test("feature plane estimates distributed projective motion despite exposure change", () => {
  const source = texture(),
    tracker = new FeaturePlane(width, height);
  assert.equal(tracker.place(source, 120, 160).state, "tracking");
  const h = [1.015, 0.014, 7, -0.009, 1.008, 4, 0.00004, -0.00002, 1];
  assertGeometry(tracker.track(warp(source, h, 0.82, 23)), h);
});
test("occluding foreground never replaces the initial plane and original background can be reacquired", () => {
  const source = texture(),
    tracker = new FeaturePlane(width, height);
  tracker.place(source, 120, 160);
  const h = [1, 0, 6, 0, 1, 4, 0, 0, 1];
  assertGeometry(tracker.track(warp(source, h)), h);
  const good = [...tracker.homography],
    blank = new Uint8Array(source.length).fill(120);
  for (let i = 0; i < 18; i++) {
    const result = tracker.track(blank);
    assert.notEqual(result.state, "tracking");
    assert.deepEqual(result.homography, good);
  }
  const returned = tracker.track(warp(source, h, 0.9, 15));
  assertGeometry(returned, h);
  assert.equal(returned.reason, "reference-reacquired");
});
test("partial occlusion uses surviving distributed background, not the moving patch", () => {
  const source = texture(),
    tracker = new FeaturePlane(width, height);
  tracker.place(source, 120, 160);
  const h = [1, 0, 5, 0, 1, -3, 0, 0, 1],
    frame = warp(source, h);
  for (let y = 125; y < 195; y++)
    for (let x = 90; x < 150; x++) frame[y * width + x] = ((x + y) % 13) * 17;
  assertGeometry(tracker.track(frame), h);
});
test("flat surfaces and one-dimensional edges are rejected at placement", () => {
  const tracker = new FeaturePlane(width, height);
  assert.equal(tracker.place(new Uint8Array(width * height).fill(125), 120, 160).state, "lost");
  const stripe = Uint8Array.from({ length: width * height }, (_, i) =>
    i % width > 100 ? 220 : 25,
  );
  assert.equal(tracker.place(stripe, 120, 160).state, "lost");
  assert.equal(tracker.track(stripe).reason, "placement-required");
});
test("copies camera memory and explicit reposition establishes a new reference", () => {
  const source = texture(),
    untouched = source.slice(),
    tracker = new FeaturePlane(width, height);
  tracker.place(source, 120, 160);
  source.fill(0);
  const h = [1, 0, 4, 0, 1, 3, 0, 0, 1];
  assertGeometry(tracker.track(warp(untouched, h)), h);
  const moved = warp(untouched, h);
  assertGeometry(tracker.place(moved, 120, 160), [1, 0, 0, 0, 1, 0, 0, 0, 1]);
  assert.throws(() => tracker.track(new Uint8Array(12)), /frame size/);
});
test("contrast-balanced selection keeps low-contrast table features beside a bright distractor", () => {
  const source = texture().map((v) => 105 + Math.round(v * 0.22));
  for (let y = 150; y < 170; y++) for (let x = 110; x < 130; x++) source[y * width + x] = 250;
  const tracker = new FeaturePlane(width, height);
  const initial = tracker.place(source, 120, 160);
  assert.equal(initial.state, "tracking");
  assert.ok(initial.features >= 35, `Only ${initial.features} features`);
  const h = [1, 0, 3, 0, 1, 2, 0, 0, 1];
  assertGeometry(tracker.track(warp(source, h)), h);
});
test("abrupt foreground-like shrink is not accepted as camera motion", () => {
  const source = texture(),
    tracker = new FeaturePlane(width, height);
  tracker.place(source, 120, 160);
  const collapse = [0.4, 0, 72, 0, 0.4, 96, 0, 0, 1];
  const result = tracker.track(warp(source, collapse));
  assert.notEqual(result.state, "tracking");
  assert.deepEqual(result.homography, [1, 0, 0, 0, 1, 0, 0, 0, 1]);
});
test("bounded coarse recovery finds the original plane after a large off-screen camera move", () => {
  const source = texture(),
    tracker = new FeaturePlane(width, height);
  tracker.place(source, 120, 160);
  const originalReference = tracker.reference;
  const blank = new Uint8Array(source.length).fill(127);
  for (let i = 0; i < 3; i++) assert.notEqual(tracker.track(blank).state, "tracking");
  const h = [1.08, 0, 39, 0, 1.08, 11, 0, 0, 1];
  const recovered = tracker.track(warp(source, h, 0.9, 8));
  assertGeometry(recovered, h, 1.5);
  assert.equal(recovered.reason, "reference-reacquired");
  assert.equal(tracker.reference, originalReference);
});
