// SPDX-License-Identifier: MIT
// Lab estimates only. W3C https://www.w3.org/TR/orientation-event/ defines
// device x=right,y=top,z=out of screen; rates beta=x,gamma=y,alpha=z.
// Rear optical coordinates are C*device, C=diag(1,-1,-1). A stationary scene
// rotates by exp(-C*omega*dt) in the moving camera: [-beta,+gamma,+alpha].
export const MAX_PIXELS = 640 * 360;
export function processingSize(width, height) {
  if (![width, height].every((v) => Number.isFinite(v) && v > 0))
    throw Error("Invalid camera dimensions");
  const scale = Math.min(
    1,
    640 / Math.max(width, height),
    Math.sqrt(MAX_PIXELS / (width * height)),
  );
  return [Math.max(1, Math.floor(width * scale)), Math.max(1, Math.floor(height * scale))];
}
export function intrinsics(width, height) {
  return {
    width,
    height,
    focal: Math.max(width, height) / (2 * Math.tan((65 * Math.PI) / 360)),
    cx: width / 2,
    cy: height / 2,
  };
}
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a) => a.map((v) => v / Math.hypot(...a));
export function anchorForPlane(center, normal, camera, distance = 0.65) {
  const ray = [(center[0] - camera.cx) / camera.focal, (center[1] - camera.cy) / camera.focal, 1];
  const depth = distance / dot(ray, normal);
  if (!(depth > 0 && depth < 6)) return null;
  // World is the initial camera's WebGL frame. Plane normal faces away in CV;
  // model +Y faces toward the observer above the table. No measured scale.
  const position = [ray[0] * depth, -ray[1] * depth, -depth];
  const up = [-normal[0], normal[1], normal[2]];
  const seed = Math.abs(up[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1];
  const x = unit(seed.map((v, i) => v - dot(seed, up) * up[i]));
  const z = cross(x, up);
  return [...x, 0, ...up, 0, ...z, 0, ...position, 1];
}
export function cameraMatrices(rotation, translation, camera, distance = 0.65) {
  const c = [1, -1, -1],
    viewMatrix = new Array(16).fill(0);
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 3; col++)
      viewMatrix[col * 4 + row] = c[row] * rotation[row * 3 + col] * c[col];
  for (let row = 0; row < 3; row++) viewMatrix[12 + row] = c[row] * translation[row] * distance;
  viewMatrix[15] = 1;
  const near = 0.01,
    far = 100;
  const projectionMatrix = [
    (2 * camera.focal) / camera.width,
    0,
    0,
    0,
    0,
    (2 * camera.focal) / camera.height,
    0,
    0,
    0,
    0,
    -(far + near) / (far - near),
    -1,
    0,
    0,
    (-2 * far * near) / (far - near),
    0,
  ];
  return { viewMatrix, projectionMatrix };
}

// Original derivation of the plane-induced model H = K(R + (t/d)n^T)K^-1;
// see OpenCV's camera-calibration documentation, decomposeHomographyMat:
// https://docs.opencv.org/4.x/d9/d0c/group__calib3d.html
// For orthonormal plane tangents a,b, B*a and B*b equal scaled R*a,R*b.
// Their 3x2 polar factor determines a proper rotation; the normal column then
// determines t/d. This assumes one rigid plane, a fixed initial unit normal,
// estimated pinhole intrinsics, and a camera remaining on the initial side.
// Neither metric distance nor camera calibration is measured by this fit.
export function homographyPose(Hpixel, normal, camera, matches) {
  if (
    !Array.isArray(Hpixel) ||
    Hpixel.length !== 9 ||
    !Hpixel.every(Number.isFinite) ||
    !Array.isArray(normal) ||
    normal.length !== 3 ||
    !normal.every(Number.isFinite) ||
    !camera ||
    ![camera.focal, camera.cx, camera.cy].every(Number.isFinite) ||
    camera.focal <= 0
  )
    return null;
  const normalLength = Math.hypot(...normal),
    hScale = Math.max(...Hpixel.map(Math.abs));
  if (normalLength < 1e-8 || hScale === 0) return null;
  const n = normal.map((v) => v / normalLength),
    seed = Math.abs(n[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0],
    a = unit(seed.map((v, i) => v - dot(seed, n) * n[i])),
    b = cross(n, a),
    f = camera.focal,
    { cx, cy } = camera,
    h = Hpixel.map((v) => v / hScale);
  const apply = (m, v) => [dot(m.slice(0, 3), v), dot(m.slice(3, 6), v), dot(m.slice(6, 9), v)];
  // Form B by mapping normalized optical-coordinate basis vectors through K,H,K^-1.
  const columns = [
    [f, 0, 0],
    [0, f, 0],
    [cx, cy, 1],
  ].map((v) => {
    const q = apply(h, v);
    return [(q[0] - cx * q[2]) / f, (q[1] - cy * q[2]) / f, q[2]];
  });
  const B = Array.from({ length: 9 }, (_, i) => columns[i % 3][Math.floor(i / 3)]),
    A = apply(B, a),
    D = apply(B, b),
    aa = dot(A, A),
    ab = dot(A, D),
    bb = dot(D, D),
    trace = aa + bb,
    determinant = aa * bb - ab * ab;
  if (!(trace > 0 && determinant > trace * trace * 1e-8)) return null;
  const rootDet = Math.sqrt(determinant),
    sigmaSum = Math.sqrt(trace + 2 * rootDet),
    scale = sigmaSum / 2,
    inverseFactor = sigmaSum / ((aa + rootDet) * (bb + rootDet) - ab * ab),
    u = A.map((v, i) => inverseFactor * ((bb + rootDet) * v - ab * D[i])),
    v = D.map((value, i) => inverseFactor * ((aa + rootDet) * value - ab * A[i]));
  // A rigid plane needs equal singular values in its two tangent directions.
  const rigidityError = Math.sqrt(Math.max(0, 2 * trace - sigmaSum * sigmaSum)) / sigmaSum;
  if (!Number.isFinite(rigidityError) || rigidityError > 0.12) return null;
  let observations;
  if (matches !== undefined) {
    if (!Array.isArray(matches) || matches.length < 4) return null;
    observations = matches;
  } else {
    const radius = f * 0.12;
    observations = [
      [cx, cy],
      [cx - radius, cy - radius],
      [cx + radius, cy - radius],
      [cx + radius, cy + radius],
      [cx - radius, cy + radius],
    ].map((reference) => {
      const q = apply(h, [...reference, 1]);
      return { reference, current: [q[0] / q[2], q[1] / q[2]] };
    });
  }
  if (
    !observations.every(
      (m) =>
        Array.isArray(m?.reference) &&
        m.reference.length === 2 &&
        m.reference.every(Number.isFinite) &&
        Array.isArray(m.current) &&
        m.current.length === 2 &&
        m.current.every(Number.isFinite),
    )
  )
    return null;
  // H is projective: try both signs, selecting only positive-depth, same-side pose.
  for (const sign of [1, -1]) {
    const U = u.map((value) => sign * value),
      V = v.map((value) => sign * value),
      N = cross(U, V),
      rotation = Array.from({ length: 9 }, (_, i) => {
        const row = Math.floor(i / 3),
          col = i % 3;
        return U[row] * a[col] + V[row] * b[col] + N[row] * n[col];
      }),
      rotatedNormal = apply(rotation, n),
      bn = apply(B, n),
      translationOverDistance = bn.map((value, i) => (sign * value) / scale - rotatedNormal[i]);
    if (1 + dot(rotatedNormal, translationOverDistance) <= 1e-5) continue;
    let squaredError = 0,
      valid = true;
    for (const { reference, current } of observations) {
      const ray = [(reference[0] - cx) / f, (reference[1] - cy) / f, 1],
        incidence = dot(n, ray);
      if (incidence <= 1e-5) {
        valid = false;
        break;
      }
      const q = apply(
        rotation,
        ray.map((value) => value / incidence),
      ).map((value, i) => value + translationOverDistance[i]);
      if (q[2] <= 1e-5) {
        valid = false;
        break;
      }
      squaredError +=
        ((f * q[0]) / q[2] + cx - current[0]) ** 2 + ((f * q[1]) / q[2] + cy - current[1]) ** 2;
    }
    if (valid) {
      const reprojectionError = Math.sqrt(squaredError / observations.length);
      // A substantially nonrigid homography must not become a plausible-looking pose.
      if (!Number.isFinite(reprojectionError) || reprojectionError > 6) return null;
      return { rotation, translationOverDistance, reprojectionError, rigidityError };
    }
  }
  return null;
}
