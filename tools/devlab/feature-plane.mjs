// SPDX-License-Identifier: MIT
// Original bounded lab implementation of an extendable planar feature map:
// Shi–Tomasi corner selection, pyramidal Lucas–Kanade flow with forward/backward
// checking, RANSAC homography fitting, template verification against each
// feature's own creation appearance, and bounded map growth over the plane.
// References: Shi & Tomasi, Good Features to Track (CVPR 1994);
// Lucas & Kanade, An Iterative Image Registration Technique (IJCAI 1981);
// Fischler & Bolles, Random Sample Consensus (CACM 1981);
// Wei et al., Instant Motion Tracking (2019) for the planar-region/gyro split.
// https://docs.opencv.org/4.x/d4/dee/tutorial_optical_flow.html explains the
// algorithm family. No OpenCV code or dependency is incorporated here.
//
// Plane parameterization: the placement (reference) image plane. Every feature
// stores its position in reference pixels; a feature created in a later frame is
// back-projected through the accepted homography. The homography always maps
// reference pixels to current pixels, so the rigid pose solver is unchanged.
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
export const MAX_FEATURES = 160;
const MAX_NEW_PER_FRAME = 12;
const RESERVE = 40;
const CELLS = [4, 6];
const LEVELS = 3;
const RADII = [5, 3, 3];
const MARGIN = 24;
const OFFSETS = [];
for (let dy = -5; dy <= 5; dy += 2) for (let dx = -5; dx <= 5; dx += 2) OFFSETS.push([dx, dy]);

export const project = (h, p) => {
  const d = h[6] * p[0] + h[7] * p[1] + h[8];
  return [(h[0] * p[0] + h[1] * p[1] + h[2]) / d, (h[3] * p[0] + h[4] * p[1] + h[5]) / d];
};
export function compose(a, b) {
  const h = Array.from(
    { length: 9 },
    (_, i) =>
      a[Math.floor(i / 3) * 3] * b[i % 3] +
      a[Math.floor(i / 3) * 3 + 1] * b[3 + (i % 3)] +
      a[Math.floor(i / 3) * 3 + 2] * b[6 + (i % 3)],
  );
  return Math.abs(h[8]) > 1e-12 ? h.map((v) => v / h[8]) : h;
}
export function invert(h) {
  const [a, b, c, d, e, f, g, k, l] = h;
  const adj = [
    e * l - f * k,
    c * k - b * l,
    b * f - c * e,
    f * g - d * l,
    a * l - c * g,
    c * d - a * f,
    d * k - e * g,
    b * g - a * k,
    a * e - b * d,
  ];
  const det = a * adj[0] + b * adj[3] + c * adj[6];
  if (!(Math.abs(det) > 1e-12)) return null;
  const inv = adj.map((v) => v / det);
  return Math.abs(inv[8]) > 1e-12 ? inv.map((v) => v / inv[8]) : inv;
}
// Local 2x2 Jacobian of a homography at p (numerical, exact for our use).
function jacobian(h, p) {
  const q = project(h, p),
    e = 0.5,
    qx = project(h, [p[0] + e, p[1]]),
    qy = project(h, [p[0], p[1] + e]);
  return [(qx[0] - q[0]) / e, (qy[0] - q[0]) / e, (qx[1] - q[1]) / e, (qy[1] - q[1]) / e];
}
const inBounds = (level, x, y, margin) =>
  x >= margin && y >= margin && x < level.width - margin && y < level.height - margin;
function sample(level, x, y) {
  if (x < 0 || y < 0 || x >= level.width - 1 || y >= level.height - 1) return NaN;
  const ix = x | 0,
    iy = y | 0,
    a = x - ix,
    b = y - iy,
    k = iy * level.width + ix,
    d = level.data;
  return (
    (d[k] * (1 - a) + d[k + 1] * a) * (1 - b) +
    (d[k + level.width] * (1 - a) + d[k + level.width + 1] * a) * b
  );
}
function sampleArray(level, array, x, y) {
  const ix = x | 0,
    iy = y | 0,
    a = x - ix,
    b = y - iy,
    k = iy * level.width + ix;
  return (
    (array[k] * (1 - a) + array[k + 1] * a) * (1 - b) +
    (array[k + level.width] * (1 - a) + array[k + level.width + 1] * a) * b
  );
}
class Pyramid {
  constructor(width, height) {
    this.levels = [];
    for (let l = 0, w = width, h = height; l < LEVELS; l++) {
      this.levels.push({
        width: w,
        height: h,
        data: new Float32Array(w * h),
        gx: new Float32Array(w * h),
        gy: new Float32Array(w * h),
      });
      w = Math.floor(w / 2);
      h = Math.floor(h / 2);
    }
    this.scratch = new Float32Array(width * Math.floor(height / 2) + width);
  }
  build(luma) {
    const base = this.levels[0];
    if (luma.length !== base.width * base.height) throw Error("Invalid grayscale frame size");
    base.data.set(luma);
    const kernel = [1, 4, 6, 4, 1];
    for (let l = 1; l < LEVELS; l++) {
      const prev = this.levels[l - 1],
        next = this.levels[l],
        tmp = this.scratch,
        w = next.width,
        h = next.height;
      for (let y = 0; y < prev.height; y++) {
        const row = y * prev.width,
          out = y * w;
        for (let x = 0; x < w; x++) {
          let sum = 0;
          for (let k = -2; k <= 2; k++) {
            const sx = Math.max(0, Math.min(prev.width - 1, 2 * x + k));
            sum += prev.data[row + sx] * kernel[k + 2];
          }
          tmp[out + x] = sum;
        }
      }
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          let sum = 0;
          for (let k = -2; k <= 2; k++) {
            const sy = Math.max(0, Math.min(prev.height - 1, 2 * y + k));
            sum += tmp[sy * w + x] * kernel[k + 2];
          }
          next.data[y * w + x] = sum / 256;
        }
    }
    for (const level of this.levels) {
      const { width: w, height: h, data, gx, gy } = level;
      gx.fill(0);
      gy.fill(0);
      for (let y = 1; y < h - 1; y++)
        for (let x = 1; x < w - 1; x++) {
          const k = y * w + x;
          gx[k] = (data[k + 1] - data[k - 1]) / 2;
          gy[k] = (data[k + w] - data[k - w]) / 2;
        }
    }
    return this;
  }
}
// Shi–Tomasi candidates on a stride-2 grid inside rect, using precomputed gradients.
function detectCorners(level, rect) {
  const candidates = [],
    r = 2,
    w = level.width,
    { gx, gy } = level;
  const x0 = Math.max(r + 1, Math.ceil(rect[0])),
    y0 = Math.max(r + 1, Math.ceil(rect[1])),
    x1 = Math.min(w - r - 2, Math.floor(rect[2])),
    y1 = Math.min(level.height - r - 2, Math.floor(rect[3]));
  for (let y = y0; y <= y1; y += 2)
    for (let x = x0; x <= x1; x += 2) {
      let a = 0,
        b = 0,
        c = 0;
      for (let j = -r; j <= r; j++) {
        let k = (y + j) * w + x - r;
        for (let i = -r; i <= r; i++, k++) {
          a += gx[k] * gx[k];
          b += gx[k] * gy[k];
          c += gy[k] * gy[k];
        }
      }
      const score = (a + c - Math.hypot(a - c, 2 * b)) / 50;
      if (score > 4 && score / ((a + c) / 25 || 1) > 0.055)
        candidates.push({ point: [x, y], score });
    }
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}
function hullArea(points) {
  if (points.length < 3) return 0;
  const sorted = points.map((p) => [p[0], p[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const lower = [],
    upper = [];
  for (const p of sorted) {
    while (lower.length > 1 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop();
    lower.push(p);
  }
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
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
// Pyramidal LK with zero-mean, gain-normalized patches; source and destination
// are pyramids, origin/estimate are level-0 positions. Returns the refined
// destination position or null.
const T = new Float32Array(121),
  GX = new Float32Array(121),
  GY = new Float32Array(121),
  D = new Float32Array(121);
function flow(source, destination, origin, estimate) {
  let qx = estimate[0] / 4,
    qy = estimate[1] / 4;
  for (let level = LEVELS - 1; level >= 0; level--) {
    if (level !== LEVELS - 1) {
      qx *= 2;
      qy *= 2;
    }
    const scale = 2 ** level,
      radius = RADII[level],
      src = source.levels[level],
      dst = destination.levels[level],
      px = origin[0] / scale,
      py = origin[1] / scale,
      side = 2 * radius + 1,
      n = side * side;
    if (!inBounds(src, px, py, radius + 2)) return null;
    let mean = 0;
    for (let j = -radius, i = 0; j <= radius; j++)
      for (let k = -radius; k <= radius; k++, i++) {
        T[i] = sample(src, px + k, py + j);
        GX[i] = sampleArray(src, src.gx, px + k, py + j);
        GY[i] = sampleArray(src, src.gy, px + k, py + j);
        mean += T[i];
      }
    mean /= n;
    let variance = 0,
      a = 0,
      b = 0,
      c = 0;
    for (let i = 0; i < n; i++) {
      T[i] -= mean;
      variance += T[i] * T[i];
      a += GX[i] * GX[i];
      b += GX[i] * GY[i];
      c += GY[i] * GY[i];
    }
    if (variance < 100) return null;
    const determinant = a * c - b * b;
    if (determinant < 1e-4 || determinant / (a + c) ** 2 < 0.002) return null;
    for (let iteration = 0; iteration < 12; iteration++) {
      if (!inBounds(dst, qx, qy, radius + 2)) return null;
      let meanD = 0;
      for (let j = -radius, i = 0; j <= radius; j++)
        for (let k = -radius; k <= radius; k++, i++) {
          D[i] = sample(dst, qx + k, qy + j);
          meanD += D[i];
        }
      meanD /= n;
      let varD = 0;
      for (let i = 0; i < n; i++) {
        D[i] -= meanD;
        varD += D[i] * D[i];
      }
      if (varD < 100) return null;
      const gain = Math.sqrt(variance / varD);
      if (gain < 0.3 || gain > 3) return null;
      let ex = 0,
        ey = 0;
      for (let i = 0; i < n; i++) {
        const residual = T[i] - gain * D[i];
        ex += GX[i] * residual;
        ey += GY[i] * residual;
      }
      const dx = (c * ex - b * ey) / determinant,
        dy = (a * ey - b * ex) / determinant;
      if (!Number.isFinite(dx + dy) || Math.hypot(dx, dy) > 5) return null;
      qx += dx;
      qy += dy;
      if (Math.hypot(dx, dy) < 0.025) break;
    }
  }
  return [qx, qy];
}
function ncc(template, values) {
  let ma = 0,
    mb = 0;
  const n = template.length;
  for (let i = 0; i < n; i++) {
    ma += template[i];
    mb += values[i];
  }
  ma /= n;
  mb /= n;
  let aa = 0,
    bb = 0,
    ab = 0;
  for (let i = 0; i < n; i++) {
    const a = template[i] - ma,
      b = values[i] - mb;
    aa += a * a;
    bb += b * b;
    ab += a * b;
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
    const x = match.reference[0] / scale,
      y = match.reference[1] / scale,
      u = match.current[0] / scale,
      v = match.current[1] / scale;
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
  if (best.length < 10 || best.length / matches.length < 0.5) return null;
  const h = fit(best, scale);
  return h && { h, matches: best.filter((m) => error(h, m) < 1.8) };
}
export class FeaturePlane {
  constructor(width, height) {
    if (![width, height].every((n) => Number.isInteger(n) && n >= 64) || width * height > 640 * 640)
      throw Error("Invalid tracking dimensions");
    this.width = width;
    this.height = height;
    this.pool = [];
    this.reference = null;
    this.previous = null;
    this.retired = null;
    this.homography = [...IDENTITY];
    this.features = [];
    this.failures = 0;
    this.frame = 0;
    this.added = 0;
  }
  acquire() {
    return this.pool.pop() ?? new Pyramid(this.width, this.height);
  }
  release(pyramid) {
    if (pyramid && pyramid !== this.reference && this.pool.length < 3) this.pool.push(pyramid);
  }
  visible(h = this.homography, margin = MARGIN) {
    return this.features.filter((f) => {
      const q = project(h, f.p);
      return Number.isFinite(q[0] + q[1]) && inBounds(this.levels0, q[0], q[1], margin);
    });
  }
  get levels0() {
    return { width: this.width, height: this.height };
  }
  // A feature remembers where it lives on the plane and how it looked when created.
  createFeature(pyramid, h, q) {
    const inv = invert(h);
    if (!inv) return null;
    const p = project(inv, q);
    if (!Number.isFinite(p[0] + p[1])) return null;
    const J = jacobian(h, p),
      det = J[0] * J[3] - J[1] * J[2];
    if (!(Math.abs(det) > 1e-6)) return null;
    const Jinv = [J[3] / det, -J[1] / det, -J[2] / det, J[0] / det];
    const fine = new Float32Array(OFFSETS.length),
      coarse = new Float32Array(OFFSETS.length),
      finePoints = new Float32Array(OFFSETS.length * 2),
      coarsePoints = new Float32Array(OFFSETS.length * 2);
    const level0 = pyramid.levels[0],
      level2 = pyramid.levels[2];
    for (let i = 0; i < OFFSETS.length; i++) {
      const [dx, dy] = OFFSETS[i];
      for (const [points, values, level, factor] of [
        [finePoints, fine, level0, 1],
        [coarsePoints, coarse, level2, 4],
      ]) {
        const rx = p[0] + factor * (Jinv[0] * dx + Jinv[1] * dy),
          ry = p[1] + factor * (Jinv[2] * dx + Jinv[3] * dy);
        points[2 * i] = rx;
        points[2 * i + 1] = ry;
        const s = project(h, [rx, ry]);
        values[i] = sample(level, s[0] / factor, s[1] / factor);
      }
    }
    if (![...fine, ...coarse].every(Number.isFinite)) return null;
    return {
      p,
      fine,
      coarse,
      finePoints,
      coarsePoints,
      misses: 0,
      born: this.frame,
      seen: this.frame,
    };
  }
  correlation(feature, h, pyramid, coarse = false) {
    const values = new Float32Array(OFFSETS.length),
      points = coarse ? feature.coarsePoints : feature.finePoints,
      level = pyramid.levels[coarse ? 2 : 0],
      factor = coarse ? 4 : 1;
    for (let i = 0; i < OFFSETS.length; i++) {
      const s = project(h, [points[2 * i], points[2 * i + 1]]);
      values[i] = sample(level, s[0] / factor, s[1] / factor);
      if (!Number.isFinite(values[i])) return 0;
    }
    return ncc(coarse ? feature.coarse : feature.fine, values);
  }
  result(state, reason, matches = []) {
    return {
      state,
      reason,
      homography: [...this.homography],
      matches: matches.map((m) => ({ reference: [...m.reference], current: [...m.current] })),
      inliers: matches.length,
      features: this.features.length,
      visible: this.reference ? this.visible().length : 0,
      added: this.added,
      failures: this.failures,
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
    const reference = this.acquire().build(luma),
      rx = this.width * 0.36,
      ry = this.height * 0.25;
    this.roi = [
      Math.max(MARGIN, x - rx),
      Math.max(MARGIN, y - ry),
      Math.min(this.width - MARGIN - 1, x + rx),
      Math.min(this.height - MARGIN - 1, y + ry),
    ];
    const candidates = detectCorners(reference.levels[0], this.roi),
      selected = [],
      cells = new Map(),
      minimum = (candidates[Math.floor(candidates.length * 0.1)]?.score ?? Infinity) * 0.015;
    // Reject edge-only structure, then balance contrast across cells. The upper
    // decile (rather than one strongest corner) prevents a bright object from
    // suppressing the many weaker but spatially distributed tabletop corners.
    for (const candidate of candidates) {
      if (candidate.score < minimum) break;
      const [cx, cy] = candidate.point,
        cell =
          Math.min(3, Math.floor((4 * (cx - this.roi[0])) / (this.roi[2] - this.roi[0]))) +
          4 * Math.min(3, Math.floor((4 * (cy - this.roi[1])) / (this.roi[3] - this.roi[1])));
      if ((cells.get(cell) ?? 0) >= 6 || selected.some((p) => Math.hypot(cx - p[0], cy - p[1]) < 9))
        continue;
      selected.push(candidate.point);
      cells.set(cell, (cells.get(cell) ?? 0) + 1);
      if (selected.length === 80) break;
    }
    for (const pyramid of [this.reference, this.previous, this.retired]) this.release(pyramid);
    this.reference = null;
    this.previous = null;
    this.retired = null;
    this.failures = 0;
    this.frame = 0;
    this.added = 0;
    this.homography = [...IDENTITY];
    this.features = [];
    this.supportArea = hullArea(selected);
    if (
      selected.length < 14 ||
      this.supportArea < (this.roi[2] - this.roi[0]) * (this.roi[3] - this.roi[1]) * 0.25
    ) {
      this.release(reference);
      return this.result("lost", "insufficient-distributed-texture");
    }
    this.reference = reference;
    this.previous = reference;
    this.features = selected.map((q) => this.createFeature(reference, IDENTITY, q)).filter(Boolean);
    return this.result(
      "tracking",
      "reference-established",
      this.features.map((f) => ({ reference: [...f.p], current: [...f.p] })),
    );
  }
  // Track features from `source` (whose image positions are project(sourceH, p))
  // into `current`, starting at the seeded prediction. Every accepted fit passes
  // consensus, appearance, support and geometry gates; failure returns null.
  attempt(source, sourceH, current, seed) {
    const matches = [],
      scale = Math.max(this.width, this.height);
    for (const feature of this.features) {
      const origin = project(sourceH, feature.p),
        estimate = project(seed, feature.p);
      if (
        !Number.isFinite(origin[0] + origin[1] + estimate[0] + estimate[1]) ||
        !inBounds(this.levels0, origin[0], origin[1], MARGIN) ||
        !inBounds(this.levels0, estimate[0], estimate[1], MARGIN)
      )
        continue;
      const q = flow(source, current, origin, estimate);
      if (!q) continue;
      const back = flow(current, source, q, origin);
      if (!back || Math.hypot(back[0] - origin[0], back[1] - origin[1]) > 1.2) continue;
      matches.push({ reference: feature.p, current: q, feature });
    }
    let fitResult = ransac(matches, scale);
    if (!fitResult) return null;
    const verified = fitResult.matches.filter(
      (m) => this.correlation(m.feature, fitResult.h, current) > 0.7,
    );
    if (verified.length < Math.max(10, fitResult.matches.length * 0.6)) return null;
    fitResult = ransac(verified, scale);
    if (!fitResult || fitResult.matches.length < 10) return null;
    const h = fitResult.h,
      currents = fitResult.matches.map((m) => m.current);
    // Spatial support in the current image: a tight cluster (a hand, one object)
    // cannot define the plane. Require area and distinct cells.
    if (hullArea(currents) < this.width * this.height * 0.02) return null;
    const cells = new Set(
      currents.map(
        (q) => Math.floor((6 * q[0]) / this.width) + 6 * Math.floor((8 * q[1]) / this.height),
      ),
    );
    if (cells.size < 4) return null;
    // Geometry: the image must not fold or cross the horizon; motion relative to
    // the prediction stays bounded; apparent scale changes gradually.
    const inv = invert(h);
    if (!inv) return null;
    const corners = [
      [0, 0],
      [this.width, 0],
      [this.width, this.height],
      [0, this.height],
    ];
    const centroid = currents
      .reduce((s, q) => [s[0] + q[0], s[1] + q[1]], [0, 0])
      .map((v) => v / currents.length);
    const sign = Math.sign(inv[6] * centroid[0] + inv[7] * centroid[1] + inv[8]);
    if (corners.some((c) => sign * (inv[6] * c[0] + inv[7] * c[1] + inv[8]) <= 1e-6)) return null;
    const maxJump = Math.max(this.width, this.height) * (this.failures ? 0.35 : 0.2);
    let jump = 0;
    for (const m of fitResult.matches) {
      const predicted = project(seed, m.reference);
      jump += Math.hypot(predicted[0] - m.current[0], predicted[1] - m.current[1]);
    }
    if (jump / fitResult.matches.length > maxJump) return null;
    const reference = project(inv, centroid);
    const jh = jacobian(h, reference),
      js = jacobian(seed, reference),
      ratio = Math.sqrt(
        Math.abs((jh[0] * jh[3] - jh[1] * jh[2]) / (js[0] * js[3] - js[1] * js[2] || 1e-12)),
      );
    if (!(ratio > 0.65 && ratio < 1.55)) return null;
    if (jh[0] * jh[3] - jh[1] * jh[2] <= 0) return null;
    return fitResult;
  }
  // Lost motion can exceed LK's capture radius. Rank a fixed 13x13x3 grid (8 px
  // steps, ±48 px) around the gyro-predicted seed using each feature's coarse
  // creation template, then refine only two seeds through the same acceptance
  // gates. No new reference is established.
  recoverySeeds(current, seed) {
    const candidates = [],
      center = [this.width / 2, this.height / 2],
      features = this.visible(seed, -64).filter((_, i) => i % 2 === 0);
    if (features.length < 6) return [];
    for (const scale of [0.85, 1, 1.15])
      for (let dy = -48; dy <= 48; dy += 8)
        for (let dx = -48; dx <= 48; dx += 8) {
          const h = [...seed];
          for (let j = 0; j < 3; j++) {
            h[j] = scale * seed[j] + ((1 - scale) * center[0] + dx) * seed[6 + j];
            h[3 + j] = scale * seed[3 + j] + ((1 - scale) * center[1] + dy) * seed[6 + j];
          }
          let score = 0;
          for (const feature of features) {
            const c = this.correlation(feature, h, current, true);
            if (c > 0.55) score += c;
          }
          if (score > features.length * 0.2) candidates.push({ h, score });
        }
    candidates.sort((a, b) => b.score - a.score);
    return candidates.slice(0, 2).map((c) => c.h);
  }
  // The 3D session can reject a 2D fit without poisoning the next prediction:
  // the previous pyramid, homography and any features created this frame revert.
  checkpoint() {
    return {
      homography: this.homography,
      previous: this.previous,
      failures: this.failures,
      frame: this.frame,
      features: this.features.length,
    };
  }
  restore(checkpoint) {
    if (this.previous !== checkpoint.previous) this.release(this.previous);
    this.previous = checkpoint.previous;
    this.retired = null;
    this.homography = checkpoint.homography;
    this.failures = checkpoint.failures + 1;
    this.features = this.features.filter((f) => f.born <= checkpoint.frame);
    this.added = 0;
  }
  // Grow the map where the current image lacks tracked features. New features
  // are back-projected onto the plane through the accepted homography; points
  // that are actually off the plane fail consensus later and are pruned.
  replenish(current, fitResult) {
    this.added = 0;
    if (fitResult.matches.length < 16) return;
    const rms = Math.sqrt(
      fitResult.matches.reduce((s, m) => s + error(this.homography, m) ** 2, 0) /
        fitResult.matches.length,
    );
    if (rms > 1.2) return;
    const positions = this.visible(this.homography, -16).map((f) => project(this.homography, f.p)),
      counts = new Map(),
      cellWidth = this.width / CELLS[0],
      cellHeight = this.height / CELLS[1];
    for (const m of fitResult.matches) {
      const cell =
        Math.floor(m.current[0] / cellWidth) + CELLS[0] * Math.floor(m.current[1] / cellHeight);
      counts.set(cell, (counts.get(cell) ?? 0) + 1);
    }
    const sparse = [];
    for (let cy = 0; cy < CELLS[1]; cy++)
      for (let cx = 0; cx < CELLS[0]; cx++) {
        const count = counts.get(cx + CELLS[0] * cy) ?? 0;
        if (count < 3) sparse.push({ cx, cy, count });
      }
    sparse.sort((a, b) => a.count - b.count);
    if (!sparse.length) return;
    this.evict(MAX_NEW_PER_FRAME);
    let budget = Math.min(MAX_NEW_PER_FRAME, MAX_FEATURES - this.features.length);
    for (const { cx, cy } of sparse) {
      if (budget <= 0) break;
      const rect = [
        Math.max(MARGIN, cx * cellWidth),
        Math.max(MARGIN, cy * cellHeight),
        Math.min(this.width - MARGIN - 1, (cx + 1) * cellWidth),
        Math.min(this.height - MARGIN - 1, (cy + 1) * cellHeight),
      ];
      if (rect[2] - rect[0] < 12 || rect[3] - rect[1] < 12) continue;
      let taken = 0;
      for (const candidate of detectCorners(current.levels[0], rect)) {
        if (taken >= 3 || budget <= 0) break;
        const [x, y] = candidate.point;
        if (positions.some((p) => Math.hypot(x - p[0], y - p[1]) < 12)) continue;
        const feature = this.createFeature(current, this.homography, [x, y]);
        if (!feature) continue;
        this.features.push(feature);
        positions.push([x, y]);
        taken++;
        budget--;
        this.added++;
      }
    }
  }
  // Make room for new features by forgetting off-screen ones least recently seen.
  // A reserve of the original tapped-region features is never evicted, so the
  // placement region itself stays reacquirable after loss.
  evict(room) {
    const excess = this.features.length + room - MAX_FEATURES;
    if (excess <= 0) return;
    const visible = new Set(this.visible(this.homography, -16)),
      reserve = new Set(this.features.filter((f) => f.born === 0).slice(0, RESERVE));
    const candidates = this.features
      .filter((f) => !visible.has(f) && !reserve.has(f))
      .sort((a, b) => a.seen - b.seen)
      .slice(0, excess);
    if (!candidates.length) return;
    const drop = new Set(candidates);
    this.features = this.features.filter((f) => !drop.has(f));
  }
  prune(fitResult) {
    const inliers = new Set(fitResult.matches.map((m) => m.feature));
    for (const feature of this.visible()) {
      if (inliers.has(feature)) {
        feature.misses = 0;
        feature.seen = this.frame;
      } else feature.misses++;
    }
    this.features = this.features.filter((f) => f.misses <= 20);
    if (this.features.length > MAX_FEATURES) {
      this.features.sort((a, b) => a.misses - b.misses || b.seen - a.seen);
      this.features.length = MAX_FEATURES;
    }
  }
  // `delta` is an optional predicted inter-frame homography (current pixels of
  // the last accepted frame -> current pixels now), e.g. K R K^-1 from the gyro.
  track(luma, delta = IDENTITY) {
    if (!this.reference) return this.result("lost", "placement-required");
    if (this.retired) {
      this.release(this.retired);
      this.retired = null;
    }
    const current = this.acquire().build(luma);
    this.frame++;
    const seed = compose(delta, this.homography);
    let fitResult = this.attempt(this.previous, this.homography, current, seed);
    if (!fitResult && this.previous !== this.reference)
      fitResult = this.attempt(this.reference, IDENTITY, current, seed);
    if (!fitResult && this.failures >= 2) {
      for (const candidate of this.recoverySeeds(current, seed)) {
        fitResult =
          this.attempt(this.reference, IDENTITY, current, candidate) ??
          this.attempt(this.previous, this.homography, current, candidate);
        if (fitResult) break;
      }
    }
    if (!fitResult) {
      this.failures++;
      this.added = 0;
      this.release(current);
      return this.result(
        this.failures > 15 ? "lost" : "recovering",
        "insufficient-background-consensus",
      );
    }
    const reason = this.failures ? "reference-reacquired" : "background-tracked",
      steady = this.failures === 0;
    this.retired = this.previous === this.reference ? null : this.previous;
    this.homography = fitResult.h;
    this.previous = current;
    this.failures = 0;
    this.prune(fitResult);
    if (steady) this.replenish(current, fitResult);
    else this.added = 0;
    return this.result("tracking", reason, fitResult.matches);
  }
}
