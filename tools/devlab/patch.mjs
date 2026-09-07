// SPDX-License-Identifier: MIT
// Original M1c diagnostic. Plane-induced homography H=R+t*n^T/d, from
// Hartley & Zisserman, Multiple View Geometry, 2nd ed., section 13.1.
// Direct photometric alignment uses numerical Gauss-Newton (no copied implementation).
// Instant Motion Tracking (Wei et al., 2019, https://arxiv.org/abs/1907.06796)
// motivates the gyro/plane split; this is not their implementation or full algorithm.
import { intrinsics, anchorForPlane, cameraMatrices, homographyPose } from "./tracking-math.mjs";
import { FeaturePlane } from "./feature-plane.mjs";
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
  // Optical scene rotation is -C*omega, C=diag(1,-1,-1); see tracking-math.mjs.
  // Sensor axes and camera calibration still require physical validation.
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

// Visual-plane session: the initial reference and anchor live until explicit reposition.
// Motion delivery is used for the initial gravity alignment, not forced onto image rotation.
// See docs/tabletop-tracking-research.md for algorithm and timing limitations.
export class TrackingSession {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.camera = intrinsics(width, height);
    this.features = new FeaturePlane(width, height);
    this.lastMotion = null;
    this.gravity = null;
    this.pending = null;
    this.pendingAt = null;
    this.anchorMatrix = null;
    this.normal = null;
    this.center = null;
    this.lastPose = null;
    this.lastAccepted = null;
    this.recoveries = 0;
    this.recovering = false;
    this.candidate = null;
    this.distance = 0.65;
  }
  motion(samples) {
    for (const sample of samples) {
      if (
        !Number.isFinite(sample.time) ||
        (this.lastMotion !== null && sample.time <= this.lastMotion)
      )
        continue;
      if (
        sample.gravity &&
        [sample.gravity.x, sample.gravity.y, sample.gravity.z].every(Number.isFinite)
      ) {
        this.gravity = { ...sample.gravity };
        this.lastMotion = sample.time;
      }
    }
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
    this.anchorMatrix = null;
    this.lastPose = null;
    this.candidate = null;
    this.lastAccepted = null;
    this.recovering = false;
  }
  result(pose, visual, sent, motionAgeMs) {
    const H = visual.homography,
      [x, y] = this.center;
    const z = H[6] * x + H[7] * y + H[8];
    return {
      state: "tracking",
      mode: "visual-plane",
      width: this.width,
      height: this.height,
      scaleMode: "assumed",
      assumedPlaneDistanceMeters: this.distance,
      calibration: "estimated-fov-65deg-long-edge",
      anchorMatrix: [...this.anchorMatrix],
      ...cameraMatrices(pose.rotation, pose.translationOverDistance, this.camera, this.distance),
      rotation: [...pose.rotation],
      translationOverDistance: [...pose.translationOverDistance],
      screen: [(H[0] * x + H[1] * y + H[2]) / z, (H[3] * x + H[4] * y + H[5]) / z],
      inliers: visual.inliers,
      features: visual.features,
      reprojectionError: visual.reprojectionError,
      poseReprojectionError: pose.reprojectionError,
      recoveries: this.recoveries,
      motionAgeMs,
      timestampMs: sent,
      timing: "frame-callback-and-motion-delivery; no exposure/IMU calibration",
    };
  }
  frame(luma, sent) {
    if (!Number.isFinite(sent)) return { state: "lost", reason: "invalid-frame-clock" };
    const age = this.lastMotion === null ? null : sent - this.lastMotion;
    let visual, checkpoint;
    if (this.pending) {
      this.pendingAt ??= sent;
      if (!this.gravity || age === null || age < -100 || age > 500) {
        if (sent - this.pendingAt > 3000) {
          this.pending = null;
          return { state: "unplaced", reason: "sensor-permission-or-data-unavailable" };
        }
        return { state: "initializing", reason: "waiting-for-sensors", motionAgeMs: age };
      }
      const n = [this.gravity.x, -this.gravity.y, -this.gravity.z],
        norm = Math.hypot(...n);
      if (norm < 7 || norm > 12) return { state: "initializing", reason: "hold-still" };
      this.normal = n.map((v) => v / norm);
      if (this.normal[2] < 0) this.normal = this.normal.map((v) => -v);
      this.center = [this.pending[0] * this.width, this.pending[1] * this.height];
      const anchor = anchorForPlane(this.center, this.normal, this.camera, this.distance);
      if (!anchor || this.normal[2] < 0.15)
        return { state: "initializing", reason: "point-down-at-table" };
      visual = this.features.place(luma, ...this.center);
      this.pending = null;
      if (visual.state !== "tracking")
        return { state: "unplaced", reason: visual.reason, features: visual.features ?? 0 };
      this.anchorMatrix = anchor;
    } else {
      if (!this.anchorMatrix) return { state: "unplaced", reason: "tap-textured-table" };
      checkpoint = this.features.checkpoint();
      visual = this.features.track(luma);
    }
    if (visual.state !== "tracking") {
      this.recovering = true;
      this.candidate = null;
      return {
        state: "recovering",
        reason: visual.reason ?? "visual-support-lost",
        inliers: visual.inliers ?? 0,
        features: visual.features ?? 0,
        referenceRetained: true,
        motionAgeMs: age,
      };
    }
    const rejectFit = () => {
      if (checkpoint) this.features.restore(checkpoint);
    };
    const pose = homographyPose(visual.homography, this.normal, this.camera, visual.matches);
    if (!pose || ![...pose.rotation, ...pose.translationOverDistance].every(Number.isFinite)) {
      this.recovering = true;
      this.candidate = null;
      rejectFit();
      return {
        state: "recovering",
        reason: "non-rigid-or-ambiguous-pose",
        referenceRetained: true,
        inliers: visual.inliers,
        features: visual.features,
      };
    }
    // Reject sudden camera-depth jumps (foreground hand/unstable homography), never scale
    // the model to follow them. Large changes after loss require two agreeing observations.
    if (this.lastPose && this.lastAccepted !== null) {
      const dt = Math.max(0, (sent - this.lastAccepted) / 1000);
      const translationStep = Math.hypot(
        ...pose.translationOverDistance.map((v, i) => v - this.lastPose.translationOverDistance[i]),
      );
      const angularTrace = pose.rotation.reduce(
        (sum, v, i) => sum + v * this.lastPose.rotation[i],
        0,
      );
      const angle = Math.acos(Math.max(-1, Math.min(1, (angularTrace - 1) / 2)));
      // A plane homography cannot resolve a 180-degree branch by itself. Never
      // accept a gross orientation switch just because two ambiguous fits agree.
      if (angle > 1.2) {
        this.recovering = true;
        this.candidate = null;
        rejectFit();
        return {
          state: "recovering",
          reason: "orientation-branch-rejected",
          referenceRetained: true,
          inliers: visual.inliers,
          features: visual.features,
        };
      }
      const jump =
        translationStep > 0.12 + Math.min(dt, 0.5) * 1.2 || angle > 0.18 + Math.min(dt, 0.5) * 2;
      if (jump || this.recovering) {
        const agrees =
          this.candidate &&
          Math.hypot(
            ...pose.translationOverDistance.map(
              (v, i) => v - this.candidate.translationOverDistance[i],
            ),
          ) < 0.08 &&
          pose.rotation.reduce((sum, v, i) => sum + v * this.candidate.rotation[i], 0) > 2.96;
        if (!agrees) {
          this.candidate = pose;
          this.recovering = true;
          rejectFit();
          return {
            state: "recovering",
            reason: "confirming-reference",
            referenceRetained: true,
            inliers: visual.inliers,
            features: visual.features,
          };
        }
      }
    }
    if (this.recovering) this.recoveries++;
    this.recovering = false;
    this.candidate = null;
    this.lastPose = pose;
    this.lastAccepted = sent;
    return this.result(pose, visual, sent, age);
  }
}
