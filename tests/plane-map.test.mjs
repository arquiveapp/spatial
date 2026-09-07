// SPDX-License-Identifier: MIT
// Regressions for the observed phone failure: the tapped region leaving the view,
// fast inter-frame motion, and hide/show flicker. Synthetic images, not device evidence.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FeaturePlane, MAX_FEATURES, project } from "../tools/devlab/feature-plane.mjs";
import { TrackingSession, identity, integrate } from "../tools/devlab/patch.mjs";
import { intrinsics, rotationHomography } from "../tools/devlab/tracking-math.mjs";

const width = 240,
  height = 320;
// A large textured "floor" and a camera window that slides over it.
function world(w = 900, h = 900, seedStart = 91) {
  let seed = seedStart;
  const cells = 9,
    knots = Array.from({ length: Math.ceil(w / cells + 2) * Math.ceil(h / cells + 2) }, () => {
      seed = (seed * 16807) % 2147483647;
      return 25 + (seed % 200);
    }),
    stride = Math.ceil(w / cells + 2);
  const image = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const fx = x / cells,
        fy = y / cells,
        ix = Math.floor(fx),
        iy = Math.floor(fy),
        a = fx - ix,
        b = fy - iy;
      image[y * w + x] =
        (knots[iy * stride + ix] * (1 - a) + knots[iy * stride + ix + 1] * a) * (1 - b) +
        (knots[(iy + 1) * stride + ix] * (1 - a) + knots[(iy + 1) * stride + ix + 1] * a) * b;
    }
  return { image, w, h };
}
// Camera view: pixel (u,v) shows world point mapped through the inverse of `h`
// where h maps view-at-origin (reference) pixels to current view pixels.
function view(floor, h, gain = 1, offset = 0) {
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
  const out = new Uint8Array(width * height),
    ox = 300,
    oy = 300;
  for (let i = 0; i < out.length; i++) {
    const x = i % width,
      y = Math.floor(i / width),
      z = inv[6] * x + inv[7] * y + inv[8],
      u = (inv[0] * x + inv[1] * y + inv[2]) / z + ox,
      v = (inv[3] * x + inv[4] * y + inv[5]) / z + oy;
    if (u < 1 || v < 1 || u >= floor.w - 2 || v >= floor.h - 2) {
      out[i] = 127;
      continue;
    }
    const ix = Math.floor(u),
      iy = Math.floor(v),
      ax = u - ix,
      ay = v - iy,
      n = iy * floor.w + ix;
    out[i] = Math.max(
      0,
      Math.min(
        255,
        offset +
          gain *
            ((floor.image[n] * (1 - ax) + floor.image[n + 1] * ax) * (1 - ay) +
              (floor.image[n + floor.w] * (1 - ax) + floor.image[n + floor.w + 1] * ax) * ay),
      ),
    );
  }
  return out;
}
const translation = (dx, dy) => [1, 0, dx, 0, 1, dy, 0, 0, 1];
function assertGeometry(result, expected, tolerance = 1.5) {
  assert.equal(result.state, "tracking", `${result.state}: ${result.reason}`);
  for (const point of [
    [40, 60],
    [200, 60],
    [200, 260],
    [40, 260],
    [120, 160],
  ]) {
    const a = project(result.homography, point),
      b = project(expected, point);
    assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < tolerance, `${a} != ${b}`);
  }
}

test("tracking continues after the tapped region has completely left the view", () => {
  const floor = world(),
    tracker = new FeaturePlane(width, height);
  assert.equal(tracker.place(view(floor, identity()), 120, 160).state, "tracking");
  const initialFeatures = tracker.features.length;
  // Pan 6 px per frame. The initial 173x160 px region around the tap is fully
  // out of the 240x320 view after ~210 px; keep going to 330 px.
  let lastAdded = 0;
  for (let step = 1; step <= 55; step++) {
    const h = translation(-6 * step, 0);
    const result = tracker.track(view(floor, h, 0.95 + 0.001 * step, 3));
    assertGeometry(result, h, 1.5);
    lastAdded += result.added;
  }
  assert.ok(lastAdded > 0, "map never grew");
  assert.ok(tracker.features.length > initialFeatures / 2, "map collapsed");
  assert.ok(tracker.features.length <= MAX_FEATURES);
  // Every original feature now projects outside the view; the map carried the plane.
  const stillVisible = tracker.visible().filter((f) => f.born === 0);
  assert.equal(stillVisible.length, 0);
  assert.ok(tracker.visible().length >= 20);
  // Return toward the start and the original anchor position is still consistent.
  for (let step = 54; step >= 30; step -= 3) {
    const h = translation(-6 * step, 0);
    assertGeometry(tracker.track(view(floor, h)), h, 1.5);
  }
});

test("a predicted inter-frame homography lets optical flow survive a jump beyond its capture range", () => {
  const floor = world(),
    make = () => {
      const tracker = new FeaturePlane(width, height);
      tracker.place(view(floor, identity()), 120, 160);
      assertGeometry(tracker.track(view(floor, translation(2, 1))), translation(2, 1));
      return tracker;
    };
  const jump = translation(44, -30),
    frame = view(floor, jump);
  const seeded = make().track(frame, translation(42, -28));
  assertGeometry(seeded, jump, 1.5);
  const unseeded = make().track(frame);
  assert.notEqual(unseeded.state, "tracking");
});

test("rejecting a fit restores the previous pyramid and discards features created by it", () => {
  const floor = world(),
    tracker = new FeaturePlane(width, height);
  tracker.place(view(floor, identity()), 120, 160);
  const before = tracker.features.length,
    previous = tracker.previous;
  const checkpoint = tracker.checkpoint();
  const result = tracker.track(view(floor, translation(-12, 0)));
  assert.equal(result.state, "tracking");
  assert.ok(result.added > 0);
  assert.notEqual(tracker.previous, previous);
  tracker.restore(checkpoint);
  assert.equal(tracker.previous, previous);
  assert.equal(tracker.features.length, before);
  assert.deepEqual(tracker.homography, identity());
  assert.equal(tracker.failures, 1);
  // Pyramid buffers are pooled, not leaked, across many frames.
  for (let i = 0; i < 40; i++) tracker.track(view(floor, translation(-i, 0)));
  assert.ok(tracker.pool.length <= 3);
});

test("features added on a moving foreground object are pruned and the plane keeps its geometry", () => {
  const floor = world(),
    tracker = new FeaturePlane(width, height);
  tracker.place(view(floor, identity()), 120, 160);
  for (let step = 1; step <= 40; step++) {
    const h = translation(-3 * step, 2 * step),
      frame = view(floor, h);
    // A textured object drifting independently across the upper-left view.
    const ox = 20 + step * 3,
      oy = 20 + step;
    for (let y = oy; y < oy + 50; y++)
      for (let x = ox; x < ox + 50; x++)
        if (x < width && y < height) frame[y * width + x] = ((x * 7 + y * 13 + step * 5) % 23) * 11;
    assertGeometry(tracker.track(frame), h, 1.6);
  }
  assert.ok(tracker.features.length <= MAX_FEATURES);
});

test("session seeds tracking with gyro rotation and bridges a short visual gap without moving the anchor", () => {
  const w = 360,
    h = 640,
    camera = intrinsics(w, h),
    floor = world(1400, 1400, 7),
    session = new TrackingSession(w, h);
  const frameAt = (H) => {
    const [a, b, c, d, e, f, g, j, k] = H;
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
    return Uint8Array.from({ length: w * h }, (_, i) => {
      const x = i % w,
        y = Math.floor(i / w),
        z = inv[6] * x + inv[7] * y + inv[8],
        u = (inv[0] * x + inv[1] * y + inv[2]) / z + 500,
        v = (inv[3] * x + inv[4] * y + inv[5]) / z + 400;
      if (u < 1 || v < 1 || u >= floor.w - 2 || v >= floor.h - 2) return 127;
      return floor.image[Math.round(v) * floor.w + Math.round(u)];
    });
  };
  const gravity = { x: 0, y: 0, z: 9.81 };
  session.motion([
    { time: 0, rate: { alpha: 0, beta: 0, gamma: 0 }, gravity, interval: 16 },
    { time: 16, rate: { alpha: 0, beta: 0, gamma: 0 }, gravity, interval: 16 },
    { time: 32, rate: { alpha: 0, beta: 0, gamma: 0 }, gravity, interval: 16 },
  ]);
  session.place([0.5, 0.5]);
  const placed = session.frame(frameAt(identity()), 40);
  assert.equal(placed.state, "tracking", placed.reason);
  // A pure yaw of 0.35 rad/s around the optical axis for one 33 ms frame: 0.66
  // degrees, i.e. only about 3 px at the image edge; then a fast frame (20 deg/s).
  const yaw = (degPerS, dtMs) =>
    integrate(identity(), { alpha: degPerS, beta: 0, gamma: 0 }, dtMs / 1000);
  let time = 40,
    R = identity();
  const spin = (degPerS, frames) => {
    let last;
    for (let i = 0; i < frames; i++) {
      const samples = [];
      for (let k = 1; k <= 2; k++)
        samples.push({
          time: time + (k * 33) / 2,
          rate: { alpha: degPerS, beta: 0, gamma: 0 },
          gravity,
          interval: 16.5,
        });
      session.motion(samples);
      time += 33;
      R = integrate(R, { alpha: degPerS, beta: 0, gamma: 0 }, 0.033);
      last = session.frame(frameAt(rotationHomography(camera, R)), time);
    }
    return last;
  };
  let result = spin(20, 8);
  assert.equal(result.state, "tracking", result.reason);
  assert.equal(result.gyro.prediction === "disabled-inconsistent", false);
  const yawFrame = yaw(20, 33);
  assert.ok(yawFrame.every(Number.isFinite));
  // Occlusion: blank frames while the phone keeps panning; the model is bridged
  // (predicted, flagged) for a bounded time, then hidden, never re-anchored.
  const anchor = [...result.anchorMatrix];
  const blank = new Uint8Array(w * h).fill(120);
  const pan = { alpha: 0, beta: 0, gamma: 8 };
  const states = [];
  for (let i = 0; i < 60; i++) {
    session.motion([
      { time: time + 16, rate: pan, gravity, interval: 16 },
      { time: time + 32, rate: pan, gravity, interval: 16 },
    ]);
    time += 33;
    R = integrate(R, pan, 0.033);
    const lost = session.frame(blank, time);
    states.push(lost.state);
    assert.deepEqual(lost.anchorMatrix ?? anchor, anchor);
    if (lost.state === "bridging") {
      assert.equal(lost.predicted, true);
      assert.ok(lost.bridgedMs <= 1500);
      assert.ok(Array.isArray(lost.viewMatrix));
    }
  }
  assert.ok(
    states.slice(0, 45).every((s) => s === "bridging"),
    states.join(","),
  );
  assert.ok(
    states.slice(46).every((s) => s === "recovering"),
    states.join(","),
  );
  // The surface returns where the gyro predicted it: accepted at once, same anchor.
  session.motion([
    { time: time + 16, rate: { alpha: 0, beta: 0, gamma: 0 }, gravity, interval: 16 },
  ]);
  time += 33;
  const back = session.frame(frameAt(rotationHomography(camera, R)), time);
  assert.equal(back.state, "tracking", back.reason);
  assert.deepEqual(back.anchorMatrix, anchor);
  assert.equal(back.recoveries, 1);
  assert.equal(back.recoveryJumpPx, null);
  // A short occlusion stays bridged throughout; the visible jump at recovery is small.
  for (let i = 0; i < 15; i++) {
    session.motion([{ time: time + 16, rate: pan, gravity, interval: 16 }]);
    time += 33;
    R = integrate(R, pan, 0.016);
    assert.equal(session.frame(blank, time).state, "bridging");
  }
  time += 33;
  const again = session.frame(frameAt(rotationHomography(camera, R)), time);
  assert.equal(again.state, "tracking", again.reason);
  assert.equal(again.recoveries, 2);
  assert.ok(again.recoveryJumpPx < 8, `jump ${again.recoveryJumpPx}`);
  assert.ok(back.gyro.frames > 0);
});

test("placement waits for a steady gravity estimate instead of a single noisy sample", () => {
  const session = new TrackingSession(360, 640),
    image = new Uint8Array(360 * 640);
  for (let i = 0; i < image.length; i++)
    image[i] = 128 + 60 * Math.sin((i % 360) * 0.5) * Math.cos(Math.floor(i / 360) * 0.45);
  session.place([0.5, 0.5]);
  session.motion([
    { time: 100, gravity: { x: 0, y: 0, z: 9.8 } },
    { time: 150, gravity: { x: 3, y: 0, z: 9.3 } },
    { time: 200, gravity: { x: -3, y: 0, z: 9.3 } },
  ]);
  assert.equal(session.frame(image, 220).reason, "hold-still");
  session.motion([
    { time: 700, gravity: { x: 0, y: 0, z: 9.8 } },
    { time: 750, gravity: { x: 0, y: 0, z: 9.8 } },
    { time: 800, gravity: { x: 0, y: 0, z: 9.8 } },
  ]);
  assert.equal(session.frame(image, 820).state, "tracking");
});
