// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import {
  homographyPose,
  intrinsics,
  anchorForPlane,
  cameraMatrices,
} from "../tools/devlab/tracking-math.mjs";

const multiply = (a, b) =>
  Array.from({ length: 9 }, (_, i) =>
    [0, 1, 2].reduce((s, k) => s + a[Math.floor(i / 3) * 3 + k] * b[k * 3 + (i % 3)], 0),
  );
const rotation = (x, y, z) =>
  multiply(
    multiply(
      [Math.cos(z), -Math.sin(z), 0, Math.sin(z), Math.cos(z), 0, 0, 0, 1],
      [Math.cos(y), 0, Math.sin(y), 0, 1, 0, -Math.sin(y), 0, Math.cos(y)],
    ),
    [1, 0, 0, 0, Math.cos(x), -Math.sin(x), 0, Math.sin(x), Math.cos(x)],
  );
const project = (h, [x, y]) => {
  const z = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / z, (h[3] * x + h[4] * y + h[5]) / z];
};
function imageHomography(r, t, n, camera) {
  const { focal: f, cx, cy } = camera;
  return multiply(
    multiply(
      [f, 0, cx, 0, f, cy, 0, 0, 1],
      r.map((v, i) => v + t[Math.floor(i / 3)] * n[i % 3]),
    ),
    [1 / f, 0, -cx / f, 0, 1 / f, -cy / f, 0, 0, 1],
  );
}
function observations(h, camera) {
  const result = [];
  for (const x of [-60, 0, 60])
    for (const y of [-70, 0, 70]) {
      const reference = [camera.cx + x, camera.cy + y];
      result.push({ reference, current: project(h, reference) });
    }
  return result;
}
function close(actual, expected, tolerance = 1e-8) {
  assert.equal(actual.length, expected.length);
  actual.forEach((v, i) => assert(Math.abs(v - expected[i]) < tolerance, `${v} != ${expected[i]}`));
}
const transform4 = (matrix, p) =>
  Array.from({ length: 4 }, (_, row) =>
    p.reduce((sum, value, col) => sum + value * matrix[col * 4 + row], 0),
  );

test("rigid planar pose recovers tilted plane rotation and translation across portrait camera sizes", () => {
  for (const [width, height] of [
    [360, 640],
    [320, 480],
    [640, 360],
  ]) {
    const camera = intrinsics(width, height);
    for (const angle of [0, 0.12, -0.24]) {
      const n = [0, -0.6, 0.8],
        r = rotation(angle, -angle / 2, angle / 3),
        t = [0.12, -0.05, 0.18],
        h = imageHomography(r, t, n, camera);
      for (const scale of [1, -3, 1e-30, -1e20]) {
        const pose = homographyPose(
          h.map((v) => v * scale),
          n,
          camera,
          observations(h, camera),
        );
        assert(pose);
        close(pose.rotation, r);
        close(pose.translationOverDistance, t);
        assert(pose.reprojectionError < 1e-8);
      }
    }
  }
});

test("rigid pose gives the same image anchor through the actual WebGL matrices", () => {
  const camera = intrinsics(360, 640),
    n = [0.2, -0.56, Math.sqrt(1 - 0.2 ** 2 - 0.56 ** 2)],
    h = imageHomography(rotation(-0.08, 0.12, 0.04), [-0.12, 0.03, 0.2], n, camera),
    pose = homographyPose(h, n, camera, observations(h, camera)),
    reference = [165, 365];
  assert(pose);
  const anchor = anchorForPlane(reference, n, camera, 0.65),
    matrices = cameraMatrices(pose.rotation, pose.translationOverDistance, camera, 0.65),
    clip = transform4(
      matrices.projectionMatrix,
      transform4(matrices.viewMatrix, transform4(anchor, [0, 0, 0, 1])),
    ),
    pixel = [
      ((clip[0] / clip[3] + 1) * camera.width) / 2,
      ((1 - clip[1] / clip[3]) * camera.height) / 2,
    ];
  close(pixel, project(h, reference));
});

test("noisy correspondences report rigid reprojection error without warping the rotation", () => {
  const camera = intrinsics(360, 640),
    n = [0, -0.6, 0.8],
    r = rotation(0.05, -0.1, 0.03),
    h = imageHomography(r, [0.02, 0.03, 0.08], n, camera),
    matches = observations(h, camera).map((m, i) => ({
      reference: m.reference,
      current: [m.current[0] + Math.sin(i) * 0.6, m.current[1] + Math.cos(i) * 0.6],
    })),
    pose = homographyPose(h, n, camera, matches);
  assert(pose);
  assert(Math.abs(pose.reprojectionError - 0.6) < 1e-8);
  close(pose.rotation, r);
  assert.equal(
    homographyPose(
      h,
      n,
      camera,
      matches.map((m) => ({ ...m, current: [m.current[0] + 30, m.current[1]] })),
    ),
    null,
  );
});

test("rejects singular, reflected, behind-camera and strongly nonrigid homographies", () => {
  const camera = intrinsics(360, 640),
    n = [0, 0, 1],
    identity = rotation(0, 0, 0);
  assert.equal(homographyPose(new Array(9).fill(0), n, camera), null);
  assert.equal(homographyPose([1, 0, 0, 0, 0, 0, 0, 0, 1], n, camera), null);
  const reflection = imageHomography([-1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 0, 0], n, camera);
  assert.equal(homographyPose(reflection, n, camera), null);
  // Reference rays cannot intersect a plane facing behind the reference camera.
  assert.equal(homographyPose(identity, [0, 0, -1], camera), null);
  const shear = imageHomography([1, 0.5, 0, 0, 1, 0, 0, 0, 1], [0, 0, 0], n, camera);
  assert.equal(homographyPose(shear, n, camera), null);
  assert.equal(homographyPose(identity, [0, 0, 0], camera), null);
  assert.equal(homographyPose(identity, n, { ...camera, focal: 0 }), null);
});

test("projective sign ambiguity cannot establish a temporal rotation branch", () => {
  const camera = intrinsics(360, 640),
    n = [0, 0, 1],
    h = imageHomography(rotation(0, 0, 0), [0, 0, -2], n, camera),
    pose = homographyPose(h, n, camera);
  // This behind-camera construction has the same image H as a visible plane
  // rotated 180 degrees in-plane. Temporal/gyro gating must disambiguate it.
  assert(pose);
  close(pose.rotation, rotation(0, 0, Math.PI));
  close(pose.translationOverDistance, [0, 0, 0]);
});
