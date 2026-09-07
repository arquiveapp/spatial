// SPDX-License-Identifier: MIT
// Regressions for the observed phone failure: the tapped region leaving the view,
// fast inter-frame motion, and hide/show flicker. Synthetic images, not device evidence.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FeaturePlane, MAX_FEATURES, project } from "../tools/devlab/feature-plane.mjs";
import {
  TrackingSession,
  identity,
  integrate,
  MAPPINGS,
  mappingLabel,
} from "../tools/devlab/patch.mjs";
import { intrinsics, rotationHomography, relativeAngle } from "../tools/devlab/tracking-math.mjs";

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

// Shared 360x640 synthetic session: a large floor viewed through a homography.
function sessionFixture() {
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
  return { w, h, camera, session, frameAt, gravity };
}
// Rotate the synthetic camera for `frames` frames at device `rate`, delivering two
// gyro samples per frame; the image follows the true mapping given.
function spin(fixture, state, rate, frames, mapping = undefined) {
  const { session, camera, frameAt, gravity } = fixture;
  let last;
  for (let i = 0; i < frames; i++) {
    session.motion([
      { time: state.time + 16, rate, gravity, interval: 16 },
      { time: state.time + 32, rate, gravity, interval: 16 },
    ]);
    state.time += 33;
    state.R = integrate(state.R, rate, 0.033, mapping);
    last = session.frame(frameAt(rotationHomography(camera, state.R)), state.time);
  }
  return last;
}

test("session validates the gyro mapping, predicts flow, and bridges a short visual gap without moving the anchor", () => {
  const fixture = sessionFixture(),
    { w, h, camera, session, frameAt, gravity } = fixture;
  session.place([0.5, 0.5]);
  const placed = session.frame(frameAt(identity()), 40);
  assert.equal(placed.state, "tracking", placed.reason);
  const state = { time: 40, R: identity() };
  // Mixed-axis rotation so exactly one signed permutation agrees with the image.
  let result = spin(fixture, state, { alpha: 14, beta: -9, gamma: 11 }, 36);
  assert.equal(result.state, "tracking", result.reason);
  assert.equal(result.gyro.prediction, "active");
  assert.equal(result.gyro.mapping, "-b,+g,+a");
  assert.ok(result.gyro.residualRatio < 0.5, `ratio ${result.gyro.residualRatio}`);
  // Occlusion: blank frames while the phone keeps panning; the model is bridged by the
  // validated gyro (not frozen) for up to 2.5 s, then hidden, never re-anchored.
  const anchor = [...result.anchorMatrix];
  const blank = new Uint8Array(w * h).fill(120);
  const pan = { alpha: 0, beta: 0, gamma: 6 };
  const states = [];
  for (let i = 0; i < 90; i++) {
    session.motion([
      { time: state.time + 16, rate: pan, gravity, interval: 16 },
      { time: state.time + 32, rate: pan, gravity, interval: 16 },
    ]);
    state.time += 33;
    state.R = integrate(state.R, pan, 0.033);
    const lost = session.frame(blank, state.time);
    states.push(lost.state);
    assert.deepEqual(lost.anchorMatrix ?? anchor, anchor);
    if (lost.state === "bridging") {
      assert.equal(lost.predicted, true);
      assert.equal(lost.frozen, false);
      assert.ok(lost.bridgedMs <= 2500);
      assert.ok(Array.isArray(lost.viewMatrix));
    }
  }
  assert.ok(
    states.slice(0, 75).every((s) => s === "bridging"),
    states.join(","),
  );
  assert.ok(
    states.slice(77).every((s) => s === "recovering"),
    states.join(","),
  );
  // The surface returns where the gyro predicted it: accepted at once, same anchor.
  session.motion([
    { time: state.time + 16, rate: { alpha: 0, beta: 0, gamma: 0 }, gravity, interval: 16 },
  ]);
  state.time += 33;
  const back = session.frame(frameAt(rotationHomography(camera, state.R)), state.time);
  assert.equal(back.state, "tracking", back.reason);
  assert.deepEqual(back.anchorMatrix, anchor);
  assert.equal(back.recoveries, 1);
  assert.equal(back.recoveryJumpPx, null);
  // A short occlusion stays bridged throughout; the gyro-predicted position and the
  // reacquired visual position agree within a few pixels, so no visible jump.
  for (let i = 0; i < 15; i++) {
    session.motion([
      { time: state.time + 16, rate: pan, gravity, interval: 16 },
      { time: state.time + 32, rate: pan, gravity, interval: 16 },
    ]);
    state.time += 33;
    state.R = integrate(state.R, pan, 0.033);
    assert.equal(session.frame(blank, state.time).state, "bridging");
  }
  state.time += 33;
  const again = session.frame(frameAt(rotationHomography(camera, state.R)), state.time);
  assert.equal(again.state, "tracking", again.reason);
  assert.equal(again.recoveries, 2);
  assert.ok(again.recoveryJumpPx < 12, `jump ${again.recoveryJumpPx}`);
});

test("gyro axis mapping is selected from agreement with the visual rotation, not assumed", () => {
  // A device whose rates follow a different signed permutation than the derivation.
  const trueMapping = MAPPINGS.find((m) => mappingLabel(m) === "+b,-g,-a");
  const fixture = sessionFixture(),
    { session, frameAt } = fixture;
  session.place([0.5, 0.5]);
  assert.equal(session.frame(frameAt(identity()), 40).state, "tracking");
  const state = { time: 40, R: identity() };
  const result = spin(fixture, state, { alpha: 14, beta: -9, gamma: 11 }, 36, trueMapping);
  assert.equal(result.state, "tracking", result.reason);
  assert.equal(result.gyro.prediction, "active");
  assert.equal(result.gyro.mapping, "+b,-g,-a");
  assert.ok(result.gyro.residualRatio < 0.5, `ratio ${result.gyro.residualRatio}`);
});

test("scanning builds a provisional map, offers placement after a swept surface, and anchors the tap through the homography", () => {
  const fixture = sessionFixture(),
    { w, h, session, frameAt, gravity } = fixture;
  let time = 40;
  const first = session.frame(frameAt(identity()), time);
  assert.equal(first.state, "scanning");
  assert.equal(first.reason, "reference-established");
  assert.equal(first.surfaceReady, false);
  // Sweep: the view slides over the floor a few pixels per frame.
  const still = { alpha: 0, beta: 0, gamma: 0 },
    slide = (i) => [1, 0, -4 * i, 0, 1, 2 * i, 0, 0, 1];
  let last;
  for (let i = 1; i <= 24; i++) {
    session.motion([{ time: time + 16, rate: still, gravity, interval: 16 }]);
    time += 33;
    last = session.frame(frameAt(slide(i)), time);
    assert.equal(last.state, "scanning", last.reason);
  }
  assert.equal(last.surfaceReady, true);
  assert.equal(last.reason, "surface-ready");
  assert.ok(last.features >= 50);
  // The tap anchors through the homography of the frame the user saw (the last
  // accepted one); on the next frame the anchor has moved with the view by exactly one
  // frame of motion (-4, +2), i.e. it stays on the tapped floor point.
  session.place([0.5, 0.62]);
  time += 33;
  const placed = session.frame(frameAt(slide(25)), time);
  assert.equal(placed.state, "tracking", placed.reason);
  assert.ok(
    Math.hypot(placed.screen[0] - (0.5 * w - 4), placed.screen[1] - (0.62 * h + 2)) < 2,
    `anchor at ${placed.screen}`,
  );
  // Reposition keeps the mature map: scanning is ready at once, and the next tap
  // anchors elsewhere without a new reference.
  const reference = session.features.reference;
  session.unplace();
  time += 33;
  const scan = session.frame(frameAt(slide(26)), time);
  assert.equal(scan.state, "scanning");
  assert.equal(scan.surfaceReady, true);
  session.place([0.3, 0.5]);
  time += 33;
  const again = session.frame(frameAt(slide(27)), time);
  assert.equal(again.state, "tracking", again.reason);
  assert.notDeepEqual(again.anchorMatrix, placed.anchorMatrix);
  assert.equal(session.features.reference, reference);
  assert.ok(Math.hypot(again.screen[0] - (0.3 * w - 4), again.screen[1] - (0.5 * h + 2)) < 2);
});

test("the plane filter keeps only map points below the horizon and within three placement depths", () => {
  // Phone tilted only ~24 degrees from vertical, looking mostly across the room: the
  // floor fills the lower part of the image and the horizon crosses it near y=100.
  const fixture = sessionFixture(),
    { w, h, session, frameAt } = fixture;
  session.gravitySamples = [];
  const tilted = { x: 0, y: 8.99, z: 3.93 }; // |g| 9.81
  session.gravity = tilted;
  session.motion([
    { time: 0, gravity: tilted },
    { time: 16, gravity: tilted },
    { time: 32, gravity: tilted },
  ]);
  const first = session.frame(frameAt(identity()), 40);
  assert.equal(first.state, "scanning", first.reason);
  assert.equal(typeof session.features.planeFilter, "function");
  const filter = session.features.planeFilter;
  assert.equal(filter([w / 2, h * 0.58]), true, "placement centre is on the plane");
  assert.equal(filter([w / 2, h * 0.95]), true, "floor below the centre is closer");
  assert.equal(filter([w / 2, 2]), false, "top of the image is above the horizon");
  assert.equal(filter([w / 2, 150]), false, "floor near the horizon is beyond three depths");
  // After sliding for a while, every map feature still satisfies the filter.
  let time = 40;
  for (let i = 1; i <= 20; i++) {
    time += 33;
    session.frame(frameAt([1, 0, -3 * i, 0, 1, 2 * i, 0, 0, 1]), time);
  }
  assert.ok(session.features.features.length >= 30);
  assert.ok(session.features.features.every((f) => filter(f.p)));
});

test("the predicted homography keeps the floor when a large off-plane object slides across it", () => {
  // Floor plus a large textured object covering the upper-left ~40% of the view and
  // sliding the opposite way (+4, -3 px per frame versus the floor's -3, +2). Without a
  // prediction the object can outvote the floor; with it the floor wins every frame.
  // Residual drift of a few pixels over 35 frames remains: features created while the
  // object hid the original region inherit small fit bias (no global optimisation).
  const floor = world(),
    object = world(700, 700, 5),
    tracker = new FeaturePlane(width, height);
  tracker.place(view(floor, identity()), 120, 160);
  let previous = identity();
  for (let step = 1; step <= 35; step++) {
    const h = translation(-3 * step, 2 * step),
      frame = view(floor, h);
    for (let y = 0; y < 190; y++)
      for (let x = 0; x < 150; x++) {
        const u = 200 + x - 4 * step,
          v = 200 + y + 3 * step;
        frame[y * width + x] = object.image[v * object.w + u];
      }
    // The session's seed: exact inter-frame motion, as a well-calibrated gyro would give
    // for rotation; here the synthetic motion is a translation of the same magnitude.
    const delta = [1, 0, h[2] - previous[2], 0, 1, h[5] - previous[5], 0, 0, 1];
    const result = tracker.track(frame, delta);
    assertGeometry(result, h, step <= 12 ? 1.5 : 6);
    previous = h;
  }
});

test("gyro integrates real rotation whether the interval arrives in ms or iOS seconds", () => {
  // iOS Safari reports event.interval in seconds (~0.016); the spec intends ms.
  // Both must integrate the same physical rotation; timestamps disambiguate.
  const rate = { alpha: 30, beta: 0, gamma: 0 };
  for (const [label, interval] of [
    ["ms", 16],
    ["ios-seconds", 0.016],
    ["absent", undefined],
  ]) {
    const session = new TrackingSession(360, 640);
    const samples = [];
    for (let i = 1; i <= 30; i++)
      samples.push({ time: i * 16, rate, gravity: { x: 0, y: 0, z: 9.8 }, interval });
    session.motion(samples);
    // 30 Hz-ish, 30 deg/s over ~0.46 s ≈ 0.24 rad of accumulated scene rotation.
    session.lastFrameTime = 16;
    const R = session.rotationBetween(16, 480);
    const angle = relativeAngle(R, identity());
    assert.ok(angle > 0.2 && angle < 0.32, `${label}: integrated ${angle.toFixed(3)} rad`);
  }
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
