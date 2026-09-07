# Fourth on-device tabletop diagnostic — 2026-09-07

Receipt `SP-3BB644D8`, iPhone 16 (user-entered), UA iOS 18_7, Safari 27.0, build `b4efe73`
(`dirty:false`), kind `tabletop`, 89.6 s, six placements after scanning, size 1×. Paired 31 s
screen recording (kept out of Git). On-device telemetry, not a gate. The user: much better now,
but when approaching the model it loses the reference and cannot follow; it should keep the place
in mind even without seeing the whole floor; it should stay rigid and not go "ghost" so often.

## What improved

| Metric                     | `SP-B41E8F71` (3c9d73a) | `SP-3BB644D8` (b4efe73)   |
| -------------------------- | ----------------------- | ------------------------- |
| processed / dropped frames | 1347 / 237 (18% lost)   | 2486 / 58 (**2% lost**)   |
| engineMs mean / p95        | 24.9 / 32               | **11.5 / 17**             |
| phaseMs pyramid            | 14.5                    | **0.4**                   |
| poseAgeAtRender mean       | 50 ms                   | **36 ms**                 |
| gyro.prediction / mapping  | active, `-a,+b,+g`      | active, `-a,+b,+g` (0.23) |
| taps before readiness      | 0                       | 0                         |

## What is still wrong

`stateFrames`: scanning 394, tracking 508, bridging 372, **recovering 1212**. Only nine loss
intervals were closed by recovery; the rest ended when the user re-tapped, which the report did
not record. Six of the nine closed losses are `non-rigid-or-ambiguous-pose`, one lasting 7.8 s
(12.9–20.7 s). The recording shows exactly this: the apartment tracks while the phone is far,
then as the user walks toward it the model dims (bridging) and disappears (recovering) although
the parquet is fully visible and textured; the user re-scans and re-places.

Mechanism: the visual homography keeps passing every image gate while approaching, but the rigid
decomposition under the assumed 65° field of view and the gravity normal fails the 9 px
reprojection gate. The rigid residual of a planar homography grows with the baseline when the
intrinsics or the normal are off, so a large approach is exactly where it fails; a pure zoom
about the principal point is intrinsics-invariant, a tilted-plane approach is not. Each
rejection also restored the tracker checkpoint, so the map could not grow at the new scale.

## Changes made in response (build after `b4efe73`)

- Plane-based self-calibration in the session: 15 field-of-view candidates (50–85°) and 25
  small tilts of the gravity normal are scored by the rigid reprojection error of the accepted
  homography on large-baseline frames; a clearly better candidate is adopted and the anchor is
  re-derived from the same tapped reference pixel (`intrinsics.fovDeg`, `source`,
  `normalAdjustedDeg` in the report). This follows the plane-based self-calibration idea of
  scoring focal-length hypotheses by the geometric consistency of homography decompositions;
  see references in [tracking research](../tabletop-tracking-research.md).
- Degraded pose: when the strict decomposition fails but a lenient one (rigidity ≤ 0.2,
  reprojection ≤ 25 px) exists, the session keeps tracking with `degraded:true` instead of
  hiding, and no longer rolls the tracker back; gross non-rigidity is still rejected.
- Bridged poses stay at full opacity for 300 ms and fade only afterwards.
- A re-tap during a loss now records the interval with `endedBy:"replaced"`;
  `metrics.replacedDuringLoss` and `metrics.degradedFrames` are reported.

Unverified on the phone. The next run should show `intrinsics.source:"estimated"` after the
first seconds of movement, far fewer `non-rigid-or-ambiguous-pose` losses, and continuous
tracking while approaching.
