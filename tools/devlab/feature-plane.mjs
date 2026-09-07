// SPDX-License-Identifier: MIT
// Original bounded lab implementation of Shi–Tomasi corner selection,
// pyramidal Lucas–Kanade flow with forward/backward checking, and RANSAC.
// References: Shi & Tomasi, Good Features to Track (CVPR 1994),
// Lucas & Kanade, An Iterative Image Registration Technique (IJCAI 1981),
// Fischler & Bolles, Random Sample Consensus (CACM 1981).
// https://docs.opencv.org/4.x/d4/dee/tutorial_optical_flow.html explains the
// algorithm family. No OpenCV code or dependency is incorporated here.
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const MAX_FEATURES = 80;
const project = (h, p) => {
  const d = h[6] * p[0] + h[7] * p[1] + h[8];
  return [(h[0] * p[0] + h[1] * p[1] + h[2]) / d, (h[3] * p[0] + h[4] * p[1] + h[5]) / d];
};
function sample(im, x, y) {
  if (x < 0 || y < 0 || x >= im.width - 1 || y >= im.height - 1) return NaN;
  const ix = Math.floor(x),
    iy = Math.floor(y),
    a = x - ix,
    b = y - iy,
    k = iy * im.width + ix;
  return (
    (im.data[k] * (1 - a) + im.data[k + 1] * a) * (1 - b) +
    (im.data[k + im.width] * (1 - a) + im.data[k + im.width + 1] * a) * b
  );
}
function pyramid(luma, width, height) {
  if (luma.length !== width * height) throw Error("Invalid grayscale frame size");
  const levels = [{ data: Float32Array.from(luma), width, height }];
  for (let level = 1; level < 3; level++) {
    const prev = levels[level - 1],
      w = Math.floor(prev.width / 2),
      h = Math.floor(prev.height / 2),
      data = new Float32Array(w * h);
    const kernel = [1, 4, 6, 4, 1];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let sum = 0;
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++)
            sum +=
              prev.data[
                Math.max(0, Math.min(prev.height - 1, 2 * y + dy)) * prev.width +
                  Math.max(0, Math.min(prev.width - 1, 2 * x + dx))
              ] *
              kernel[dy + 2] *
              kernel[dx + 2];
        data[y * w + x] = sum / 256;
      }
    levels.push({ data, width: w, height: h });
  }
  return levels;
}
function corners(im, roi) {
  const candidates = [],
    r = 2;
  for (let y = Math.ceil(roi[1]); y <= roi[3]; y += 2)
    for (let x = Math.ceil(roi[0]); x <= roi[2]; x += 2) {
      let a = 0,
        b = 0,
        c = 0;
      for (let j = -r; j <= r; j++)
        for (let i = -r; i <= r; i++) {
          const gx = (sample(im, x + i + 1, y + j) - sample(im, x + i - 1, y + j)) / 2;
          const gy = (sample(im, x + i, y + j + 1) - sample(im, x + i, y + j - 1)) / 2;
          a += gx * gx;
          b += gx * gy;
          c += gy * gy;
        }
      const score = (a + c - Math.hypot(a - c, 2 * b)) / 50;
      if (score > 4 && score / ((a + c) / 25 || 1) > 0.055)
        candidates.push({ point: [x, y], score });
    }
  // Reject edge-only structure, then balance contrast across cells. The upper
  // decile (rather than one strongest corner) prevents a bright object from
  // suppressing the many weaker but spatially distributed tabletop corners.
  candidates.sort((a, b) => b.score - a.score);
  const selected = [],
    cells = new Map(),
    minimum = (candidates[Math.floor(candidates.length * 0.1)]?.score ?? Infinity) * 0.015;
  for (const candidate of candidates) {
    if (candidate.score < minimum) break;
    const [x, y] = candidate.point;
    const cell =
      Math.min(3, Math.floor((4 * (x - roi[0])) / (roi[2] - roi[0]))) +
      4 * Math.min(3, Math.floor((4 * (y - roi[1])) / (roi[3] - roi[1])));
    if ((cells.get(cell) ?? 0) >= 6 || selected.some((p) => Math.hypot(x - p[0], y - p[1]) < 9))
      continue;
    selected.push(candidate.point);
    cells.set(cell, (cells.get(cell) ?? 0) + 1);
    if (selected.length === MAX_FEATURES) break;
  }
  return selected;
}
function patch(im, p, radius) {
  const data = [],
    gx = [],
    gy = [];
  for (let y = -radius; y <= radius; y++)
    for (let x = -radius; x <= radius; x++) {
      data.push(sample(im, p[0] + x, p[1] + y));
      gx.push((sample(im, p[0] + x + 1, p[1] + y) - sample(im, p[0] + x - 1, p[1] + y)) / 2);
      gy.push((sample(im, p[0] + x, p[1] + y + 1) - sample(im, p[0] + x, p[1] + y - 1)) / 2);
    }
  if (![...data, ...gx, ...gy].every(Number.isFinite)) return null;
  const mean = data.reduce((s, v) => s + v, 0) / data.length;
  const centered = data.map((v) => v - mean),
    variance = centered.reduce((s, v) => s + v * v, 0);
  return { data: centered, gx, gy, variance };
}
function flow(source, destination, origin, estimate) {
  let q = estimate.map((v) => v / 4);
  for (let level = 2; level >= 0; level--) {
    if (level !== 2) q = q.map((v) => v * 2);
    const scale = 2 ** level,
      p = origin.map((v) => v / scale),
      radius = level === 0 ? 5 : 3;
    const template = patch(source[level], p, radius);
    if (!template || template.variance < 100) return null;
    const { gx, gy } = template;
    let a = 0,
      b = 0,
      c = 0;
    for (let i = 0; i < gx.length; i++) {
      a += gx[i] ** 2;
      b += gx[i] * gy[i];
      c += gy[i] ** 2;
    }
    const determinant = a * c - b * b;
    if (determinant < 1e-4 || determinant / (a + c) ** 2 < 0.002) return null;
    for (let iteration = 0; iteration < 12; iteration++) {
      const values = [];
      for (let y = -radius; y <= radius; y++)
        for (let x = -radius; x <= radius; x++)
          values.push(sample(destination[level], q[0] + x, q[1] + y));
      if (!values.every(Number.isFinite)) return null;
      const mean = values.reduce((s, v) => s + v, 0) / values.length;
      let variance = 0;
      for (const value of values) variance += (value - mean) ** 2;
      if (variance < 100) return null;
      const gain = Math.sqrt(template.variance / variance);
      if (gain < 0.3 || gain > 3) return null;
      let ex = 0,
        ey = 0;
      for (let i = 0; i < values.length; i++) {
        const residual = template.data[i] - gain * (values[i] - mean);
        ex += gx[i] * residual;
        ey += gy[i] * residual;
      }
      const dx = (c * ex - b * ey) / determinant,
        dy = (a * ey - b * ex) / determinant;
      if (!Number.isFinite(dx + dy) || Math.hypot(dx, dy) > 5) return null;
      q[0] += dx;
      q[1] += dy;
      if (Math.hypot(dx, dy) < 0.025) break;
    }
  }
  return q;
}
function correlation(reference, current, point, h) {
  const a = [],
    b = [];
  for (let dy = -5; dy <= 5; dy += 2)
    for (let dx = -5; dx <= 5; dx += 2) {
      const p = [point[0] + dx, point[1] + dy],
        q = project(h, p);
      a.push(sample(reference, ...p));
      b.push(sample(current, ...q));
    }
  if (![...a, ...b].every(Number.isFinite)) return 0;
  const ma = a.reduce((s, v) => s + v, 0) / a.length,
    mb = b.reduce((s, v) => s + v, 0) / b.length;
  let aa = 0,
    bb = 0,
    ab = 0;
  for (let i = 0; i < a.length; i++) {
    aa += (a[i] - ma) ** 2;
    bb += (b[i] - mb) ** 2;
    ab += (a[i] - ma) * (b[i] - mb);
  }
  return ab / Math.sqrt(aa * bb || Infinity);
}
function solve(matrix, rhs) {
  const n = rhs.length,
    a = matrix.map((row, i) => [...row, rhs[i]]);
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[pivot][c])) pivot = r;
    if (Math.abs(a[pivot][c]) < 1e-10) return null;
    [a[pivot], a[c]] = [a[c], a[pivot]];
    const divisor = a[c][c];
    for (let j = c; j <= n; j++) a[c][j] /= divisor;
    for (let r = 0; r < n; r++)
      if (r !== c) {
        const value = a[r][c];
        for (let j = c; j <= n; j++) a[r][j] -= value * a[c][j];
      }
  }
  return a.map((row) => row[n]);
}
function fit(matches, scale) {
  const matrix = Array.from({ length: 8 }, () => Array(8).fill(0)),
    rhs = Array(8).fill(0);
  for (const match of matches) {
    const [x, y] = match.reference.map((v) => v / scale),
      [u, v] = match.current.map((n) => n / scale);
    const rows = [
      [x, y, 1, 0, 0, 0, -u * x, -u * y],
      [0, 0, 0, x, y, 1, -v * x, -v * y],
    ];
    for (let k = 0; k < 2; k++)
      for (let i = 0; i < 8; i++) {
        rhs[i] += rows[k][i] * (k === 0 ? u : v);
        for (let j = 0; j < 8; j++) matrix[i][j] += rows[k][i] * rows[k][j];
      }
  }
  const h = solve(matrix, rhs);
  return h && [h[0], h[1], h[2] * scale, h[3], h[4], h[5] * scale, h[6] / scale, h[7] / scale, 1];
}
const error = (h, match) => {
  const q = project(h, match.reference);
  return Math.hypot(q[0] - match.current[0], q[1] - match.current[1]);
};
function ransac(matches, scale) {
  if (matches.length < 10) return null;
  let seed = 48271,
    best = [],
    bestError = Infinity;
  for (let trial = 0; trial < 128; trial++) {
    const indices = new Set();
    while (indices.size < 4) {
      seed = (seed * 16807) % 2147483647;
      indices.add(seed % matches.length);
    }
    const h = fit(
      [...indices].map((i) => matches[i]),
      scale,
    );
    if (!h) continue;
    const inliers = matches.filter((m) => error(h, m) < 1.8),
      e = inliers.reduce((s, m) => s + error(h, m), 0);
    if (inliers.length > best.length || (inliers.length === best.length && e < bestError)) {
      best = inliers;
      bestError = e;
    }
  }
  if (best.length < 10 || best.length / matches.length < 0.55) return null;
  const h = fit(best, scale);
  return h && { h, matches: best.filter((m) => error(h, m) < 1.8) };
}
function hullArea(points) {
  const pointsSorted = points.map((p) => [...p]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const lower = [],
    upper = [];
  for (const p of pointsSorted) {
    while (lower.length > 1 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop();
    lower.push(p);
  }
  for (const p of pointsSorted.toReversed()) {
    while (upper.length > 1 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop();
    upper.push(p);
  }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  return (
    Math.abs(
      hull.reduce((sum, p, i) => {
        const q = hull[(i + 1) % hull.length];
        return sum + p[0] * q[1] - p[1] * q[0];
      }, 0),
    ) / 2
  );
}
export class FeaturePlane {
  constructor(width, height) {
    if (![width, height].every((n) => Number.isInteger(n) && n >= 64) || width * height > 640 * 640)
      throw Error("Invalid tracking dimensions");
    this.width = width;
    this.height = height;
    this.reference = null;
    this.homography = [...IDENTITY];
    this.features = [];
    this.failures = 0;
  }
  result(state, reason, matches = []) {
    return {
      state,
      reason,
      homography: [...this.homography],
      matches,
      inliers: matches.length,
      features: this.features.length,
      reprojectionError: matches.length
        ? Math.sqrt(
            matches.reduce((sum, m) => sum + error(this.homography, m) ** 2, 0) / matches.length,
          )
        : null,
    };
  }
  place(luma, x, y) {
    if (![x, y].every(Number.isFinite) || x < 0 || y < 0 || x >= this.width || y >= this.height)
      throw Error("Invalid placement point");
    const reference = pyramid(luma, this.width, this.height),
      rx = this.width * 0.36,
      ry = this.height * 0.25;
    this.roi = [
      Math.max(20, x - rx),
      Math.max(20, y - ry),
      Math.min(this.width - 21, x + rx),
      Math.min(this.height - 21, y + ry),
    ];
    this.features = corners(reference[0], this.roi);
    this.reference = null;
    this.previous = null;
    this.failures = 0;
    this.homography = [...IDENTITY];
    this.supportArea = hullArea(this.features);
    if (
      this.features.length < 14 ||
      this.supportArea < (this.roi[2] - this.roi[0]) * (this.roi[3] - this.roi[1]) * 0.25
    )
      return this.result("lost", "insufficient-distributed-texture");
    this.reference = reference;
    this.previous = reference;
    return this.result(
      "tracking",
      "reference-established",
      this.features.map((p) => ({ reference: [...p], current: [...p] })),
    );
  }
  attempt(source, current, fromReference, seed = this.homography) {
    const matches = [];
    for (const reference of this.features) {
      const estimate = project(seed, reference),
        origin = fromReference ? reference : estimate;
      const q = flow(source, current, origin, estimate);
      if (!q) continue;
      const back = flow(current, source, q, origin);
      if (!back || Math.hypot(back[0] - origin[0], back[1] - origin[1]) > 1.2) continue;
      matches.push({ reference: [...reference], current: q });
    }
    let fitResult = ransac(matches, Math.max(this.width, this.height));
    if (!fitResult) return null;
    const verified = fitResult.matches.filter(
      (m) => correlation(this.reference[0], current[0], m.reference, fitResult.h) > 0.78,
    );
    fitResult = ransac(verified, Math.max(this.width, this.height));
    if (!fitResult || fitResult.matches.length < Math.max(10, this.features.length * 0.25))
      return null;
    const points = fitResult.matches.map((m) => m.reference);
    if (hullArea(points) < this.supportArea * 0.3) return null;
    const [x0, y0, x1, y1] = this.roi,
      corners = [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ];
    const warped = corners.map((p) => project(fitResult.h, p)),
      old = corners.map((p) => project(this.homography, p));
    if (!warped.flat().every(Number.isFinite)) return null;
    // A valid plane cannot fold, cross the camera horizon, or abruptly collapse
    // onto a moving foreground hand. Preserve the last accepted pose on failure.
    const denominators = corners.map((p) => fitResult.h[6] * p[0] + fitResult.h[7] * p[1] + 1);
    if (denominators.some((d) => d < 0.25 || d > 4)) return null;
    const orientation = warped.reduce((sum, p, i) => {
      const q = warped[(i + 1) % warped.length];
      return sum + p[0] * q[1] - p[1] * q[0];
    }, 0);
    if (orientation <= 0) return null;
    const area = hullArea(warped),
      baseArea = (x1 - x0) * (y1 - y0),
      ratio = area / hullArea(old);
    if (area / baseArea < 0.15 || area / baseArea > 6 || ratio < 0.65 || ratio > 1.55) return null;
    const maxJump = Math.max(this.width, this.height) * (this.failures ? 0.35 : 0.2);
    if (warped.some((p, i) => Math.hypot(p[0] - old[i][0], p[1] - old[i][1]) > maxJump))
      return null;
    return fitResult;
  }
  // Lost motion can exceed LK's capture radius. Rank a fixed 9x9x3 grid on
  // the original coarse image, then refine only two seeds. This proposes
  // hypotheses; the same full-resolution FB, appearance, RANSAC, support and
  // geometry gates still decide acceptance. No new reference is established.
  recoverySeeds(current) {
    const candidates = [],
      center = [this.width / 2, this.height / 2];
    const points = this.features.filter((_, i) => i % 3 === 0).map((p) => p.map((v) => v / 4));
    for (const scale of [0.85, 1, 1.15])
      for (let dy = -64; dy <= 64; dy += 16)
        for (let dx = -64; dx <= 64; dx += 16) {
          const h = [...this.homography];
          for (let j = 0; j < 3; j++) {
            h[j] =
              scale * this.homography[j] + ((1 - scale) * center[0] + dx) * this.homography[6 + j];
            h[3 + j] =
              scale * this.homography[3 + j] +
              ((1 - scale) * center[1] + dy) * this.homography[6 + j];
          }
          const coarse = [h[0], h[1], h[2] / 4, h[3], h[4], h[5] / 4, h[6] * 4, h[7] * 4, h[8]];
          const correlations = points.map((p) =>
            correlation(this.reference[2], current[2], p, coarse),
          );
          const score = correlations.reduce((sum, c) => sum + (c > 0.55 ? c : 0), 0);
          if (score > points.length * 0.2) candidates.push({ h, score, dx, dy, scale });
        }
    candidates.sort((a, b) => b.score - a.score);
    return candidates.slice(0, 2).map((c) => c.h);
  }
  // Pyramid images are immutable owned copies; checkpointing is constant-time.
  // The 3D session can reject a 2D fit without poisoning the next prediction.
  checkpoint() {
    return { homography: this.homography, previous: this.previous, failures: this.failures };
  }
  restore(checkpoint) {
    this.homography = checkpoint.homography;
    this.previous = checkpoint.previous;
    this.failures = checkpoint.failures + 1;
  }
  track(luma) {
    if (!this.reference) return this.result("lost", "placement-required");
    const current = pyramid(luma, this.width, this.height);
    let fitResult = this.attempt(this.previous, current, false);
    if (!fitResult && this.previous !== this.reference)
      fitResult = this.attempt(this.reference, current, true);
    if (!fitResult && this.failures >= 2) {
      for (const seed of this.recoverySeeds(current)) {
        fitResult = this.attempt(this.reference, current, true, seed);
        if (fitResult) break;
      }
    }
    if (!fitResult) {
      this.failures++;
      return this.result(
        this.failures > 15 ? "lost" : "recovering",
        "insufficient-background-consensus",
      );
    }
    this.homography = fitResult.h;
    this.previous = current;
    const reason = this.failures ? "reference-reacquired" : "background-tracked";
    this.failures = 0;
    return this.result("tracking", reason, fitResult.matches);
  }
}
