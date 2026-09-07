// SPDX-License-Identifier: MIT
// Original M1c diagnostic. Plane-induced homography H=R+t*n^T/d, from
// Hartley & Zisserman, Multiple View Geometry, 2nd ed., section 13.1.
// Direct photometric alignment uses numerical Gauss-Newton (no copied implementation).
// Instant Motion Tracking (Wei et al., 2019, https://arxiv.org/abs/1907.06796)
// motivates the gyro/plane split; this is not their implementation or full algorithm.
import {
  intrinsics,
  anchorForPlane,
  cameraMatrices,
  homographyPose,
  rotationHomography,
  multiply3,
  transpose3,
  relativeAngle,
  anchorScreen,
} from "./tracking-math.mjs";
import { FeaturePlane, project, invert } from "./feature-plane.mjs";
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
// Signed axis permutations from W3C device rates (alpha, beta, gamma) to the optical
// angular-velocity vector. tracking-math.mjs derives [-beta, +gamma, +alpha] for a rear
// camera held in portrait. The first iPhone diagnostic disagreed with that derivation by
// about 130% of the rotation, so the session scores every candidate against the visual
// rotation it measures and adopts the one that agrees, instead of trusting a derivation.
export const MAPPINGS = [];
for (const perm of [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
])
  for (const s0 of [1, -1])
    for (const s1 of [1, -1])
      for (const s2 of [1, -1]) MAPPINGS.push({ perm, signs: [s0, s1, s2] });
export const mappingLabel = (m) =>
  m.perm.map((p, i) => (m.signs[i] < 0 ? "-" : "+") + "abg"[p]).join(",");
export const DEFAULT_MAPPING = MAPPINGS.find((m) => mappingLabel(m) === "-b,+g,+a");
export const mapRates = (vector, mapping = DEFAULT_MAPPING) =>
  mapping.perm.map((p, i) => mapping.signs[i] * vector[p]);
// exp([v]x) R for a small rotation vector v (radians), Rodrigues form.
export function rotateBy(R, v) {
  const angle = Math.hypot(v[0], v[1], v[2]);
  if (!(angle > 1e-10)) return R;
  const a = v[0] / angle,
    b = v[1] / angle,
    c = v[2] / angle,
    s = Math.sin(angle),
    w = 1 - Math.cos(angle),
    co = Math.cos(angle);
  return multiply(
    [
      co + a * a * w,
      a * b * w - c * s,
      a * c * w + b * s,
      b * a * w + c * s,
      co + b * b * w,
      b * c * w - a * s,
      c * a * w - b * s,
      c * b * w + a * s,
      co + c * c * w,
    ],
    R,
  );
}
// Rotation vector (axis * angle) of R; inverse of rotateBy for |angle| < pi.
export function rotationVector(R) {
  const angle = Math.acos(Math.max(-1, Math.min(1, (R[0] + R[4] + R[8] - 1) / 2)));
  if (angle < 1e-9) return [0, 0, 0];
  const k = angle / (2 * Math.sin(angle));
  return [(R[7] - R[5]) * k, (R[2] - R[6]) * k, (R[3] - R[1]) * k];
}
export function integrate(R, rate, dt, mapping = DEFAULT_MAPPING) {
  if (
    !rate ||
    ![rate.alpha, rate.beta, rate.gamma, dt].every(Number.isFinite) ||
    dt <= 0 ||
    dt > 0.1
  )
    return R;
  const k = (Math.PI / 180) * dt;
  return rotateBy(R, mapRates([rate.alpha * k, rate.beta * k, rate.gamma * k], mapping));
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
    this.camera = intrinsics(w, h);
    this.f = this.camera.focal;
    this.distance = 0.65;
    this.anchorMatrix = null;
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
    this.anchorMatrix = null;
    this.t = [0, 0, 0];
    if (!gravity || ![gravity.x, gravity.y, gravity.z].every(Number.isFinite))
      return { state: "lost", reason: "gravity-unavailable" };
    const n = [gravity.x, -gravity.y, -gravity.z],
      norm = Math.hypot(...n);
    if (norm < 5 || norm > 15) return { state: "lost", reason: "hold-still" };
    this.normal = n.map((v) => v / norm);
    const ray = [(x - this.w / 2) / this.f, (y - this.h / 2) / this.f, 1];
    const incidence = ray.reduce((sum, v, i) => sum + v * this.normal[i], 0);
    if (Math.abs(incidence) < 0.16) return { state: "lost", reason: "aim-down-at-table" };
    if (incidence < 0) this.normal = this.normal.map((v) => -v);
    this.anchorMatrix = anchorForPlane([x, y], this.normal, this.camera, this.distance);
    if (!this.anchorMatrix) return { state: "lost", reason: "aim-down-at-table" };
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
    return this.result(identity(), 0, this.points.length);
  }
  track(im, R) {
    if (!this.points.length) return { state: "lost", reason: "place-on-texture" };
    const candidate = [...this.t];
    // Bounded coarse translation search increases capture range before local alignment.
    // Gyro supplies rotation; search modifies translation only, never a fake screen pose.
    const p = [(this.center[0] - this.w / 2) / this.f, (this.center[1] - this.h / 2) / this.f, 1];
    const incidence = p.reduce((sum, v, i) => sum + v * this.normal[i], 0);
    let best = Infinity,
      shift = [0, 0];
    for (let dy = -12; dy <= 12; dy += 3)
      for (let dx = -12; dx <= 12; dx += 3) {
        const trial = [
          candidate[0] + dx / this.f / incidence,
          candidate[1] + dy / this.f / incidence,
          candidate[2],
        ];
        let cost = 0,
          count = 0;
        for (let i = 0; i < this.points.length; i += 4) {
          const [x, y, ref] = this.points[i],
            q = this.project(x, y, R, trial);
          const value = q ? sample(im, ...q, this.w, this.h) : null;
          if (value !== null) {
            cost += Math.min(3600, (value - ref) ** 2);
            count++;
          }
        }
        if (count >= this.points.length / 8 && cost / count < best) {
          best = cost / count;
          shift = [dx, dy];
        }
      }
    candidate[0] += shift[0] / this.f / incidence;
    candidate[1] += shift[1] / this.f / incidence;
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
    // Verify the final pose against all visible samples, including rejected outliers.
    let sum = 0,
      count = 0;
    for (const [x, y, ref] of this.points) {
      const q = this.project(x, y, R, candidate),
        value = q ? sample(im, ...q, this.w, this.h) : null;
      if (value !== null) {
        sum += (value - ref) ** 2;
        count++;
      }
    }
    residual = Math.sqrt(sum / Math.max(1, count));
    if (count < this.points.length * 0.75 || residual > 25 || Math.hypot(...candidate) > 2)
      return { state: "lost", reason: "photometric-error", residual };
    this.t = candidate;
    return this.result(R, residual, valid);
  }
  result(R, residual, valid) {
    return {
      state: "tracking",
      width: this.w,
      height: this.h,
      assumedPlaneDistanceMeters: this.distance,
      calibration: "estimated-fov-65deg-long-edge",
      anchorMatrix: this.anchorMatrix,
      ...cameraMatrices(R, this.t, this.camera, this.distance),
      scaleMode: "assumed",
      translationOverDistance: [...this.t],
      rotation: [...R],
      screen: this.project(...this.center, R),
      residual,
      samples: valid,
    };
  }
}

// Visual-plane session. A provisional plane map starts as soon as the phone aims down
// steadily ("scanning"); the surface counts as ready after sustained tracking under
// motion, and a tap then anchors the model through the current homography inside that
// mature map. The gyroscope's axis mapping and delivery offset are selected online by
// agreement with the visual rotation; when validated, the gyro predicts optical flow
// and bridges short visual gaps, otherwise gaps are bridged by a briefly frozen pose.
// See docs/tabletop-tracking-research.md for algorithm and timing limitations.
const LATENCY_CANDIDATES = [0, 30, 60, 90];
const READY_FRAMES = 20;
const READY_FEATURES = 50;
export class TrackingSession {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.camera = intrinsics(width, height);
    this.features = new FeaturePlane(width, height);
    this.lastMotion = null;
    this.gravity = null;
    this.gravitySamples = [];
    this.gyro = [];
    this.gyroSamples = 0;
    this.pending = null;
    this.pendingAt = null;
    this.anchorMatrix = null;
    this.normal = null;
    this.center = null;
    this.lastPose = null;
    this.lastAccepted = null;
    this.lastFrameTime = null;
    this.recoveries = 0;
    this.recovering = false;
    this.candidate = null;
    this.distance = 0.65;
    // Exact scene rotation since the last accepted frame under the active mapping and
    // delivery offset (seeds prediction), plus small-angle device vectors per offset
    // that score every candidate axis mapping against the measured visual rotation.
    this.accumulated = identity();
    this.deviceAngle = Object.fromEntries(LATENCY_CANDIDATES.map((l) => [l, [0, 0, 0]]));
    this.consistency = Object.fromEntries(
      LATENCY_CANDIDATES.map((l) => [l, MAPPINGS.map(() => ({ frames: 0, residual: 0, gyro: 0 }))]),
    );
    this.mapping = DEFAULT_MAPPING;
    this.latencyMs = 30;
    this.prediction = "untested";
    this.calibrationFrames = 0;
    this.bestRatio = null;
    this.bridgeMs = 1500;
    this.frozenBridgeMs = 700;
    this.lastMotionSpeed = 0;
    this.bridged = null;
    this.bridgedAt = null;
    this.surfaceReady = false;
    this.readyFrames = 0;
    this.scanLost = 0;
    this.scanRotation = 0;
    this.scanTranslation = 0;
    this.provisionalAt = null;
  }
  motion(samples) {
    for (const sample of samples) {
      if (
        !Number.isFinite(sample.time) ||
        (this.lastMotion !== null && sample.time <= this.lastMotion)
      )
        continue;
      const g = sample.gravity;
      if (g && [g.x, g.y, g.z].every(Number.isFinite)) {
        this.gravity = { ...g };
        this.gravitySamples.push({ time: sample.time, g: [g.x, g.y, g.z] });
        while (this.gravitySamples.length && this.gravitySamples[0].time < sample.time - 1000)
          this.gravitySamples.shift();
        this.lastMotion = sample.time;
      }
      const rate = sample.rate;
      if (rate && [rate.alpha, rate.beta, rate.gamma].every(Number.isFinite)) {
        // iOS Safari reports event.interval in seconds (~0.016); the W3C intent is
        // milliseconds. Delivery timestamps are unambiguous, so dt comes from them.
        const previous = this.gyro.at(-1);
        const stepMs = previous && sample.time > previous.time ? sample.time - previous.time : null;
        const intervalMs = Number.isFinite(sample.interval)
          ? sample.interval < 1
            ? sample.interval * 1000
            : sample.interval
          : null;
        const dt =
          stepMs && stepMs > 0 && stepMs < 100
            ? stepMs / 1000
            : intervalMs && intervalMs > 0 && intervalMs < 100
              ? intervalMs / 1000
              : 0.016;
        this.gyro.push({ time: sample.time, rate, dt });
        this.gyroSamples++;
        this.lastMotion = Math.max(this.lastMotion ?? -Infinity, sample.time);
        while (this.gyro.length && this.gyro[0].time < sample.time - 2500) this.gyro.shift();
      }
    }
  }
  // Exact scene rotation (camera frame, active mapping) over delivery window (t0, t1].
  rotationBetween(t0, t1) {
    let R = identity();
    for (const sample of this.gyro)
      if (sample.time > t0 && sample.time <= t1)
        R = integrate(R, sample.rate, sample.dt, this.mapping);
    return R;
  }
  // Raw device-axis small-angle vector (alpha, beta, gamma order, radians) over (t0, t1].
  deviceAngleBetween(t0, t1) {
    const v = [0, 0, 0];
    for (const sample of this.gyro)
      if (sample.time > t0 && sample.time <= t1) {
        const k = (Math.PI / 180) * sample.dt;
        v[0] += sample.rate.alpha * k;
        v[1] += sample.rate.beta * k;
        v[2] += sample.rate.gamma * k;
      }
    return v;
  }
  gravityEstimate(now) {
    const recent = this.gravitySamples.filter((s) => s.time >= now - 500);
    if (recent.length < 3) return null;
    const mean = [0, 1, 2].map((i) => recent.reduce((s, r) => s + r.g[i], 0) / recent.length);
    const spread = Math.sqrt(
      recent.reduce((s, r) => s + r.g.reduce((q, v, i) => q + (v - mean[i]) ** 2, 0), 0) /
        recent.length,
    );
    return { mean, spread, count: recent.length };
  }
  // Downward plane normal in the optical frame from steady gravity, or a scanning hint.
  planeNormal(sent, age) {
    if (!this.gravity || age === null || age < -100 || age > 500)
      return { reason: "waiting-for-sensors" };
    const estimate = this.gravityEstimate(sent);
    const g = estimate?.mean ?? [this.gravity.x, this.gravity.y, this.gravity.z];
    const n = [g[0], -g[1], -g[2]],
      norm = Math.hypot(...n);
    if (norm < 7 || norm > 12 || (estimate && estimate.spread > 0.9))
      return { reason: "hold-still" };
    let normal = n.map((v) => v / norm);
    if (normal[2] < 0) normal = normal.map((v) => -v);
    if (normal[2] < 0.15) return { reason: "point-down-at-table" };
    return { normal, spread: estimate?.spread ?? null };
  }
  place(point) {
    if (
      !Array.isArray(point) ||
      point.length !== 2 ||
      !point.every((v) => Number.isFinite(v) && v >= 0 && v <= 1)
    )
      return;
    this.pending = [...point];
    this.pendingAt = null;
  }
  // Drop the anchor but keep the plane map, so the next tap is immediate.
  unplace() {
    this.anchorMatrix = null;
    this.center = null;
    this.pending = null;
    this.candidate = null;
    this.recovering = false;
    this.bridged = null;
    this.bridgedAt = null;
  }
  dropProvisional() {
    this.features = new FeaturePlane(this.width, this.height);
    this.surfaceReady = false;
    this.readyFrames = 0;
    this.scanLost = 0;
    this.scanRotation = 0;
    this.scanTranslation = 0;
    this.lastPose = null;
    this.lastAccepted = null;
    this.provisionalAt = null;
  }
  resetAccumulators() {
    this.accumulated = identity();
    for (const l of LATENCY_CANDIDATES) this.deviceAngle[l] = [0, 0, 0];
  }
  gyroReport() {
    const active = this.consistency[this.latencyMs][MAPPINGS.indexOf(this.mapping)];
    return {
      prediction: this.prediction,
      mapping: mappingLabel(this.mapping),
      latencyMs: this.latencyMs,
      samples: this.gyroSamples,
      motionDegPerS: this.lastMotionSpeed,
      residualDeg: active.frames ? ((active.residual / active.frames) * 180) / Math.PI : null,
      residualRatio: active.gyro > 0 ? active.residual / active.gyro : null,
      frames: active.frames,
      calibrationFrames: this.calibrationFrames,
      bestRatio: this.bestRatio,
      byLatencyMs: Object.fromEntries(
        LATENCY_CANDIDATES.map((l) => {
          const c = this.consistency[l][MAPPINGS.indexOf(this.mapping)];
          return [l, c.gyro > 0 ? Math.round((c.residual / c.gyro) * 1000) / 1000 : null];
        }),
      ),
    };
  }
  // Score every (delivery offset, axis mapping) hypothesis against the visual rotation
  // since the last accepted pose, on frames with measurable gyro motion. Adopt the
  // best once it is clearly consistent; disable prediction if nothing agrees.
  calibrate(pose) {
    if (!this.gyro.length || !this.lastPose) return;
    const visual = rotationVector(multiply3(pose.rotation, transpose3(this.lastPose.rotation)));
    let counted = false;
    for (const l of LATENCY_CANDIDATES) {
      const d = this.deviceAngle[l],
        magnitude = Math.hypot(d[0], d[1], d[2]);
      if (magnitude < 0.01) continue;
      counted = true;
      const rows = this.consistency[l];
      for (let m = 0; m < MAPPINGS.length; m++) {
        const v = mapRates(d, MAPPINGS[m]),
          c = rows[m];
        c.frames++;
        c.gyro += magnitude;
        c.residual += Math.hypot(visual[0] - v[0], visual[1] - v[1], visual[2] - v[2]);
      }
    }
    if (!counted) return;
    this.calibrationFrames++;
    if (this.calibrationFrames % 5 !== 0) return;
    let best = null;
    for (const l of LATENCY_CANDIDATES)
      this.consistency[l].forEach((c, m) => {
        if (c.frames < 30 || !(c.gyro > 0)) return;
        const ratio = c.residual / c.gyro;
        // Prefer the derived default within a 5% tie so pure single-axis motion cannot
        // pick an arbitrary look-alike; otherwise the lowest residual wins.
        if (
          !best ||
          ratio < best.ratio * 0.95 ||
          (ratio < best.ratio * 1.05 && MAPPINGS[m] === DEFAULT_MAPPING && l === this.latencyMs)
        )
          best = { l, m, ratio, frames: c.frames };
      });
    if (!best) return;
    this.bestRatio = best.ratio;
    if (best.ratio < 0.5) {
      const current = this.consistency[this.latencyMs][MAPPINGS.indexOf(this.mapping)],
        currentRatio = current.gyro > 0 ? current.residual / current.gyro : Infinity;
      if (
        (MAPPINGS[best.m] !== this.mapping || best.l !== this.latencyMs) &&
        (this.prediction !== "active" || best.ratio < currentRatio * 0.8)
      ) {
        this.mapping = MAPPINGS[best.m];
        this.latencyMs = best.l;
        this.accumulated = identity();
      }
      this.prediction = "active";
    } else if (best.frames >= 60) this.prediction = "disabled-inconsistent";
  }
  matrices(pose) {
    return cameraMatrices(pose.rotation, pose.translationOverDistance, this.camera, this.distance);
  }
  scanResult(sent, age, reason, visual, pose = null) {
    return {
      state: "scanning",
      reason,
      surfaceReady: this.surfaceReady,
      readyFrames: this.readyFrames,
      width: this.width,
      height: this.height,
      inliers: visual?.inliers ?? 0,
      features: visual?.features ?? this.features.features.length,
      visibleFeatures: visual?.visible ?? 0,
      addedFeatures: visual?.added ?? 0,
      poseReprojectionError: pose?.reprojectionError ?? null,
      gyro: this.gyroReport(),
      timings: visual?.timings ?? null,
      motionAgeMs: age,
      timestampMs: sent,
    };
  }
  result(pose, visual, sent, motionAgeMs) {
    return {
      state: "tracking",
      mode: "visual-plane-map",
      width: this.width,
      height: this.height,
      scaleMode: "assumed",
      assumedPlaneDistanceMeters: this.distance,
      calibration: "estimated-fov-65deg-long-edge",
      anchorMatrix: [...this.anchorMatrix],
      ...this.matrices(pose),
      rotation: [...pose.rotation],
      translationOverDistance: [...pose.translationOverDistance],
      screen: anchorScreen(this.center, this.normal, this.camera, pose),
      inliers: visual.inliers,
      features: visual.features,
      visibleFeatures: visual.visible,
      addedFeatures: visual.added,
      reprojectionError: visual.reprojectionError,
      poseReprojectionError: pose.reprojectionError,
      recoveries: this.recoveries,
      recoveryJumpPx: pose.recoveryJumpPx ?? null,
      gyro: this.gyroReport(),
      timings: visual.timings ?? null,
      motionAgeMs,
      timestampMs: sent,
      timing: "frame-callback-and-motion-delivery; no exposure/IMU calibration",
    };
  }
  // Prediction from the last accepted pose while vision has no consensus: gyro-rotated
  // for up to 1.5 s when the mapping is validated, otherwise frozen for up to 0.7 s.
  // Explicitly a prediction, never a measurement, never a new anchor.
  bridge(sent, reason, visual, age) {
    const active = this.prediction === "active" && this.gyro.length > 0;
    if (
      !this.lastPose ||
      this.lastAccepted === null ||
      sent - this.lastAccepted > (active ? this.bridgeMs : this.frozenBridgeMs)
    )
      return null;
    const R = active ? this.accumulated : identity(),
      rotation = multiply3(R, this.lastPose.rotation),
      t = this.lastPose.translationOverDistance,
      translationOverDistance = [0, 1, 2].map(
        (r) => R[r * 3] * t[0] + R[r * 3 + 1] * t[1] + R[r * 3 + 2] * t[2],
      ),
      pose = { rotation, translationOverDistance };
    this.bridged = pose;
    this.bridgedAt = sent;
    return {
      state: "bridging",
      reason,
      predicted: true,
      frozen: !active,
      bridgedMs: sent - this.lastAccepted,
      referenceRetained: true,
      width: this.width,
      height: this.height,
      anchorMatrix: [...this.anchorMatrix],
      ...this.matrices(pose),
      screen: anchorScreen(this.center, this.normal, this.camera, pose),
      inliers: visual?.inliers ?? 0,
      features: visual?.features ?? 0,
      visibleFeatures: visual?.visible ?? 0,
      recoveries: this.recoveries,
      gyro: this.gyroReport(),
      timings: visual?.timings ?? null,
      motionAgeMs: age,
      timestampMs: sent,
    };
  }
  frame(luma, sent) {
    if (!Number.isFinite(sent)) return { state: "lost", reason: "invalid-frame-clock" };
    const age = this.lastMotion === null ? null : sent - this.lastMotion;
    let motionSpeed = 0;
    if (this.lastFrameTime !== null && sent > this.lastFrameTime) {
      for (const l of LATENCY_CANDIDATES) {
        const v = this.deviceAngleBetween(this.lastFrameTime - l, sent - l),
          a = this.deviceAngle[l];
        a[0] += v[0];
        a[1] += v[1];
        a[2] += v[2];
      }
      const delta = this.rotationBetween(
        this.lastFrameTime - this.latencyMs,
        sent - this.latencyMs,
      );
      this.accumulated = multiply3(delta, this.accumulated);
      motionSpeed =
        (relativeAngle(delta, identity()) * 180) / Math.PI / ((sent - this.lastFrameTime) / 1000);
    }
    this.lastMotionSpeed = motionSpeed;
    this.lastFrameTime = sent;
    let visual, checkpoint;
    if (this.pending) {
      this.pendingAt ??= sent;
      const mapReady =
        this.features.reference &&
        this.lastPose &&
        this.lastAccepted !== null &&
        sent - this.lastAccepted < 200 &&
        (this.surfaceReady || this.anchorMatrix);
      if (mapReady) {
        // Anchor through the current homography inside the mature map: the tapped
        // pixel becomes a plane point in reference coordinates; no re-detection.
        const q = [this.pending[0] * this.width, this.pending[1] * this.height],
          inv = invert(this.features.homography),
          p = inv ? project(inv, q) : null,
          anchor =
            p && p.every(Number.isFinite)
              ? anchorForPlane(p, this.normal, this.camera, this.distance)
              : null;
        this.pending = null;
        if (!anchor) return this.scanResult(sent, age, "point-down-at-table", null);
        this.center = p;
        this.anchorMatrix = anchor;
        this.recovering = false;
        this.candidate = null;
        this.bridged = null;
      } else if (!this.features.reference || sent - this.pendingAt > 1500) {
        // Immediate placement on a fresh single-frame reference (no provisional map
        // yet, or readiness did not arrive in time). Needs steady gravity.
        const plane = this.planeNormal(sent, age);
        if (!plane.normal) {
          if (plane.reason === "waiting-for-sensors" && sent - this.pendingAt > 3000) {
            this.pending = null;
            return { state: "unplaced", reason: "sensor-permission-or-data-unavailable" };
          }
          return { state: "initializing", reason: plane.reason, motionAgeMs: age };
        }
        this.normal = plane.normal;
        this.center = [this.pending[0] * this.width, this.pending[1] * this.height];
        const anchor = anchorForPlane(this.center, this.normal, this.camera, this.distance);
        if (!anchor) return { state: "initializing", reason: "point-down-at-table" };
        visual = this.features.place(luma, ...this.center);
        this.pending = null;
        if (visual.state !== "tracking")
          return { state: "unplaced", reason: visual.reason, features: visual.features ?? 0 };
        this.anchorMatrix = anchor;
        this.lastPose = null;
        this.lastAccepted = null;
        this.candidate = null;
        this.recovering = false;
        this.bridged = null;
        this.surfaceReady = true;
        this.readyFrames = READY_FRAMES;
        this.provisionalAt = sent;
        this.resetAccumulators();
      }
    }
    if (!visual) {
      if (!this.features.reference) {
        // Scanning: start a provisional plane map at the view centre once the phone
        // aims down steadily. Nothing is anchored; the model stays hidden.
        const plane = this.planeNormal(sent, age);
        if (!plane.normal) return this.scanResult(sent, age, plane.reason, null);
        const start = this.features.place(luma, this.width * 0.5, this.height * 0.58);
        if (start.state !== "tracking") return this.scanResult(sent, age, start.reason, start);
        this.normal = plane.normal;
        this.provisionalAt = sent;
        this.readyFrames = 0;
        this.scanLost = 0;
        this.scanRotation = 0;
        this.scanTranslation = 0;
        this.surfaceReady = false;
        this.lastPose = {
          rotation: identity(),
          translationOverDistance: [0, 0, 0],
          reprojectionError: 0,
        };
        this.lastAccepted = sent;
        this.recovering = false;
        this.candidate = null;
        this.resetAccumulators();
        return this.scanResult(sent, age, "reference-established", start, this.lastPose);
      }
      checkpoint = this.features.checkpoint();
      const seed =
        this.prediction === "active" && this.gyro.length
          ? rotationHomography(this.camera, this.accumulated)
          : undefined;
      visual = this.features.track(luma, seed);
    }
    const anchored = !!this.anchorMatrix;
    const recover = (reason, restore, keepCandidate = false) => {
      this.recovering = true;
      if (!keepCandidate) this.candidate = null;
      if (restore && checkpoint) this.features.restore(checkpoint);
      if (!anchored) {
        this.readyFrames = 0;
        this.surfaceReady = false;
        if (++this.scanLost > 30) this.dropProvisional();
        return this.scanResult(sent, age, reason, visual);
      }
      return (
        this.bridge(sent, reason, visual, age) ?? {
          state: "recovering",
          reason,
          referenceRetained: true,
          inliers: visual?.inliers ?? 0,
          features: visual?.features ?? 0,
          visibleFeatures: visual?.visible ?? 0,
          gyro: this.gyroReport(),
          timings: visual?.timings ?? null,
          motionAgeMs: age,
        }
      );
    };
    if (visual.state !== "tracking") return recover(visual.reason ?? "visual-support-lost", false);
    const pose = homographyPose(visual.homography, this.normal, this.camera, visual.matches);
    if (!pose || ![...pose.rotation, ...pose.translationOverDistance].every(Number.isFinite))
      return recover("non-rigid-or-ambiguous-pose", true);
    if (this.lastPose && this.lastAccepted !== null) {
      const dt = Math.max(0, (sent - this.lastAccepted) / 1000),
        usePrediction = this.prediction === "active" && this.gyro.length > 0,
        R = this.accumulated,
        predictedRotation = usePrediction
          ? multiply3(R, this.lastPose.rotation)
          : this.lastPose.rotation,
        lt = this.lastPose.translationOverDistance,
        predictedTranslation = usePrediction
          ? [0, 1, 2].map((r) => R[r * 3] * lt[0] + R[r * 3 + 1] * lt[1] + R[r * 3 + 2] * lt[2])
          : lt;
      const translationStep = Math.hypot(
          ...pose.translationOverDistance.map((v, i) => v - predictedTranslation[i]),
        ),
        angle = relativeAngle(pose.rotation, predictedRotation);
      // A plane homography cannot resolve a 180-degree branch by itself. Never
      // accept a gross orientation switch just because two ambiguous fits agree.
      if (angle > 1.2) return recover("orientation-branch-rejected", true);
      this.calibrate(pose);
      const jump =
        translationStep > 0.12 + Math.min(dt, 0.5) * 1.2 || angle > 0.18 + Math.min(dt, 0.5) * 2;
      if (jump || this.recovering) {
        // A pose close to the (predicted or last) pose is accepted at once. Anything
        // else needs two agreeing observations; the withheld 2D fit is kept as the
        // optical-flow reference so the confirming frame starts from the right image.
        const consistent = angle < 0.2 && translationStep < 0.15;
        const agrees =
          this.candidate &&
          Math.hypot(
            ...pose.translationOverDistance.map(
              (v, i) => v - this.candidate.translationOverDistance[i],
            ),
          ) < 0.08 &&
          pose.rotation.reduce((sum, v, i) => sum + v * this.candidate.rotation[i], 0) > 2.96;
        if (!consistent && !agrees) {
          this.candidate = pose;
          return recover("confirming-reference", false, true);
        }
      }
      // Visible jump only when a bridged (displayed) prediction preceded this frame.
      if (this.recovering && this.bridged && sent - this.bridgedAt <= 100) {
        const before = anchorScreen(this.center, this.normal, this.camera, this.bridged),
          after = anchorScreen(this.center, this.normal, this.camera, pose);
        pose.recoveryJumpPx =
          before && after ? Math.hypot(before[0] - after[0], before[1] - after[1]) : null;
      }
    }
    if (this.recovering && anchored) this.recoveries++;
    this.recovering = false;
    this.candidate = null;
    this.bridged = null;
    this.bridgedAt = null;
    this.lastPose = pose;
    this.lastAccepted = sent;
    this.scanLost = 0;
    this.resetAccumulators();
    if (!anchored) {
      this.readyFrames++;
      this.scanRotation = Math.max(this.scanRotation, relativeAngle(pose.rotation, identity()));
      this.scanTranslation = Math.max(
        this.scanTranslation,
        Math.hypot(...pose.translationOverDistance),
      );
      this.surfaceReady =
        this.readyFrames >= READY_FRAMES &&
        visual.features >= READY_FEATURES &&
        (this.scanRotation >= 0.035 || this.scanTranslation >= 0.02);
      return this.scanResult(
        sent,
        age,
        this.surfaceReady ? "surface-ready" : "sweep-surface",
        visual,
        pose,
      );
    }
    return this.result(pose, visual, sent, age);
  }
}
