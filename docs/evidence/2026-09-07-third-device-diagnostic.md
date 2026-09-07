# Third on-device tabletop diagnostic — 2026-09-07

Receipt `SP-B41E8F71`, iPhone 16 (user-entered), UA iOS 18_7, Safari 27.0, build `3c9d73a`
(`dirty:false`), kind `tabletop`, 56 s, one placement after scanning, no taps before readiness,
size 1×. On-device telemetry, not a gate. The user: "continua uma merda" (still bad).

## What changed for the better

| Metric                        | `SP-C1116A35` (9afddb4) | `SP-B41E8F71` (3c9d73a)        |
| ----------------------------- | ----------------------- | ------------------------------ |
| gyro.prediction / mapping     | disabled-inconsistent   | **active**, `-a,+b,+g`         |
| gyro.residualRatio by offset  | 1.31 everywhere         | 0.59 / **0.215** / 0.31 / 0.68 |
| render extrapolation applied  | 0                       | 499 frames                     |
| processed / dropped frames    | 1074 / 747 (59% lost)   | 1347 / 237 (**18% lost**)      |
| engineMs mean / p95           | 35.5 / 61               | 24.9 / 32                      |
| phaseMs pyramid / flow / rec. | n/a                     | **14.5** / 2.7 / 0.9           |
| poseAgeAtRender mean          | 67 ms                   | 50 ms                          |
| scanning frames before ready  | n/a                     | 86                             |

The selected mapping `[-alpha, +beta, +gamma]` means Safari's `rotationRate` components are
the device x, y, z axis rates in that order, not the W3C (z, x, y) order the derivation assumed;
with the optical frame `diag(1,-1,-1)` and the passive scene-rotation sign this is exactly the
mapping found. The 30 ms delivery offset is clearly preferred over 0 ms (0.215 vs 0.586).

## What is still wrong

- `stateFrames`: tracking 566, bridging 361, recovering 334 — a measured pose only about 45% of
  the time. 34 loss intervals: 22 `insufficient-background-consensus`, **12
  `non-rigid-or-ambiguous-pose`**, several lasting 1.6–3.4 s; recovery jumps 2–57 px.
- `stationaryJitterPx` has no samples: the phone never held still for a second while tracking.
- The pyramid build alone cost 14.5 ms per frame on the phone: three levels plus full-frame
  gradient arrays in JavaScript.

Interpretation of the losses: the map grows into every textured region of the view, including
the wall, bucket, bag and sofa base visible in this room. Under rotation those points agree with
any homography; under translation they become a large outlier set. RANSAC required 50%
consensus, so the fit failed (`insufficient-background-consensus`) or produced a mixed-depth
homography that the rigid gate rejected (`non-rigid-or-ambiguous-pose`). While consensus fails,
nothing is pruned, so the state persists until the view changes.

## Changes made in response (build after `3c9d73a`)

- Gravity-derived plane filter: a map point must lie below the horizon and within three times
  the placement depth along its reference ray; existing points failing it are dropped and new
  candidates refused.
- The gyro-predicted homography is used as a consensus hypothesis when random RANSAC fails, and
  the consensus floor falls to 35% with more trials, so a plane minority can still be recovered
  and off-plane points then get pruned.
- Pyramid without whole-level gradient arrays; gradients are sampled on demand at features and
  in corner-search cells (Node: ~0.5 ms per frame, from ~1.6 ms).
- Rigid gate cap 6 → 9 px reprojection and 0.12 → 0.15 rigidity, to tolerate assumed intrinsics
  under viewpoint change; hand or mixed-depth fits remain far above it.
- Bridging with a validated gyro extends from 1.5 s to 2.5 s.

Unverified on the phone. The next run should show fewer `non-rigid-or-ambiguous-pose` losses,
a higher tracking share of `stateFrames`, lower `phaseMs.pyramidMs`, and, if the user holds
still for a second, a `stationaryJitterPx` sample count above zero.
