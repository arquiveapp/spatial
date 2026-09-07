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
