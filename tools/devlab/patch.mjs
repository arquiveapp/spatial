// SPDX-License-Identifier: MIT
// Original M1c diagnostic. Plane-induced homography H=R+t*n^T/d, from
// Hartley & Zisserman, Multiple View Geometry, 2nd ed., section 13.1.
// Direct photometric alignment uses numerical Gauss-Newton (no copied implementation).
// Instant Motion Tracking (Wei et al., 2019, https://arxiv.org/abs/1907.06796)
// motivates the gyro/plane split; this is not their implementation or full algorithm.
export function multiply(a, b) {
  return Array.from(
    { length: 9 },
    (_, i) =>
      a[Math.floor(i / 3) * 3] * b[i % 3] +
      a[Math.floor(i / 3) * 3 + 1] * b[3 + (i % 3)] +
      a[Math.floor(i / 3) * 3 + 2] * b[6 + (i % 3)],
  );
}
export function identity() {
  return [1, 0, 0, 0, 1, 0, 0, 0, 1];
}
export function integrate(R, rate, dt) {
  if (
    !rate ||
    ![rate.alpha, rate.beta, rate.gamma, dt].every(Number.isFinite) ||
    dt <= 0 ||
    dt > 0.1
  )
    return R;
  // Portrait rear-camera prior; physical axis/calibration validation is mandatory.
  const x = ((-rate.beta * Math.PI) / 180) * dt,
    y = ((rate.gamma * Math.PI) / 180) * dt,
    z = ((rate.alpha * Math.PI) / 180) * dt;
  const angle = Math.hypot(x, y, z);
  if (angle < 1e-10) return R;
  const a = x / angle,
    b = y / angle,
    c = z / angle,
    s = Math.sin(angle),
    v = 1 - Math.cos(angle),
    co = Math.cos(angle);
  return multiply(
    [
      co + a * a * v,
      a * b * v - c * s,
      a * c * v + b * s,
      b * a * v + c * s,
      co + b * b * v,
      b * c * v - a * s,
      c * a * v - b * s,
      c * b * v + a * s,
      co + c * c * v,
    ],
    R,
  );
}
function sample(im, x, y, w, h) {
  if (x < 0 || y < 0 || x >= w - 1 || y >= h - 1) return null;
  const ix = Math.floor(x),
    iy = Math.floor(y),
    a = x - ix,
    b = y - iy;
  return (
    im[iy * w + ix] * (1 - a) * (1 - b) +
    im[iy * w + ix + 1] * a * (1 - b) +
    im[(iy + 1) * w + ix] * (1 - a) * b +
    im[(iy + 1) * w + ix + 1] * a * b
  );
}
function solve(A, b) {
  const m = A.map((r, i) => [...r, b[i]]);
  for (let k = 0; k < 3; k++) {
    let pivot = k;
    for (let i = k + 1; i < 3; i++) if (Math.abs(m[i][k]) > Math.abs(m[pivot][k])) pivot = i;
    [m[k], m[pivot]] = [m[pivot], m[k]];
    if (Math.abs(m[k][k]) < 1e-8) return null;
    const d = m[k][k];
    for (let j = k; j < 4; j++) m[k][j] /= d;
    for (let i = 0; i < 3; i++)
      if (i !== k) {
        const f = m[i][k];
        for (let j = k; j < 4; j++) m[i][j] -= f * m[k][j];
      }
  }
  return m.map((r) => r[3]);
}
export class PlanarPatch {
  constructor(w = 640, h = 360) {
    this.w = w;
    this.h = h;
    this.f = w / (2 * Math.tan((65 * Math.PI) / 360));
    this.points = [];
    this.t = [0, 0, 0];
    this.normal = [0, 0, 1];
    this.center = [w / 2, h / 2];
  }
  project(x, y, R, t = this.t) {
    const p = [(x - this.w / 2) / this.f, (y - this.h / 2) / this.f, 1];
    const d = p.reduce((s, v, i) => s + v * this.normal[i], 0);
    const q = R.reduce((a, _, i) => {
      if (i % 3 === 0) a.push(R[i] * p[0] + R[i + 1] * p[1] + R[i + 2] * p[2] + t[i / 3] * d);
      return a;
    }, []);
    if (q[2] <= 0.1) return null;
    return [(this.f * q[0]) / q[2] + this.w / 2, (this.f * q[1]) / q[2] + this.h / 2];
  }
  place(im, x, y, gravity) {
    this.points = [];
    this.t = [0, 0, 0];
    if (!gravity || ![gravity.x, gravity.y, gravity.z].every(Number.isFinite))
      return { state: "lost", reason: "gravity-unavailable" };
    const n = [gravity.x, -gravity.y, -gravity.z],
      norm = Math.hypot(...n);
    if (norm < 5 || norm > 15) return { state: "lost", reason: "hold-still" };
    this.normal = n.map((v) => v / norm);
    this.points = [];
    this.t = [0, 0, 0];
    this.center = [x, y];
    for (let dy = -36; dy <= 36; dy += 4)
      for (let dx = -36; dx <= 36; dx += 4) {
        const px = x + dx,
          py = y + dy,
          value = sample(im, px, py, this.w, this.h),
          gx = sample(im, px + 1, py, this.w, this.h),
          gy = sample(im, px, py + 1, this.w, this.h);
        if (value !== null && gx !== null && gy !== null && Math.hypot(gx - value, gy - value) > 8)
          this.points.push([px, py, value]);
      }
    if (this.points.length < 30) {
      this.points = [];
      return { state: "lost", reason: "insufficient-texture" };
    }
    return { state: "tracking", samples: this.points.length };
  }
  track(im, R) {
    if (!this.points.length) return { state: "lost", reason: "place-on-texture" };
    const candidate = [...this.t];
    let residual = Infinity,
      valid = 0;
    for (let iteration = 0; iteration < 8; iteration++) {
      const A = Array.from({ length: 3 }, () => [0, 0, 0]),
        b = [0, 0, 0];
      let sum = 0;
      valid = 0;
      for (const [x, y, reference] of this.points) {
        const uv = this.project(x, y, R, candidate);
        if (!uv) continue;
        const value = sample(im, ...uv, this.w, this.h);
        if (value === null) continue;
        const error = value - reference;
        if (Math.abs(error) > 60) continue;
        const J = [];
        for (let k = 0; k < 3; k++) {
          const t = [...candidate];
          t[k] += 0.0001;
          const q = this.project(x, y, R, t);
          const v = q ? sample(im, ...q, this.w, this.h) : null;
          J.push(v === null ? 0 : (v - value) / 0.0001);
        }
        const weight = Math.min(1, 15 / Math.max(1, Math.abs(error)));
        for (let i = 0; i < 3; i++) {
          b[i] -= weight * J[i] * error;
          for (let j = 0; j < 3; j++) A[i][j] += weight * J[i] * J[j];
        }
        sum += error * error;
        valid++;
      }
      if (valid < 30 || valid < this.points.length * 0.5)
        return { state: "lost", reason: "patch-left-view-or-outliers" };
      residual = Math.sqrt(sum / valid);
      for (let k = 0; k < 3; k++) A[k][k] += 0.001;
      const delta = solve(A, b);
      if (!delta || Math.hypot(...delta) > 0.3) return { state: "lost", reason: "unstable-fit" };
      for (let k = 0; k < 3; k++) candidate[k] += delta[k];
      if (Math.hypot(...delta) < 0.00001) break;
    }
    if (residual > 25) return { state: "lost", reason: "photometric-error", residual };
    this.t = candidate;
    return {
      state: "tracking",
      scaleMode: "assumed",
      translationOverDistance: [...candidate],
      rotation: [...R],
      screen: this.project(...this.center, R),
      residual,
      samples: valid,
    };
  }
}
