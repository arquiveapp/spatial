# Tabletop recording review — 2026-09-07

User-reported device: iPhone 16, Safari. Exact OS/browser version and the recording's loaded
commit are unverified. The user reports the tabletop experience failed; the separate 3D viewer
worked. The recording is a failure report, not a passed physical gate.

## Observed failure

The supplied 14.84-second screen recording shows the apartment disappearing with motion,
shrinking abruptly as a hand crosses the camera around 4 seconds, and failing to recover after
the hand exits. The image remains portrait without the previous aspect-ratio squeeze.

Source inspection confirms the prior session erased its reference after three rejected frames
or a sensor-delivery gap. That makes automatic recovery impossible. The small intensity patch
and lack of robust consensus are consistent with foreground capture, but the video alone cannot
prove the internal cause of each wrong pose. It contains no synchronized trace or IMU.

## Private reproducible replay

Original and derivatives remain outside Git/npm in ignored `.local/video-review/`.
`replay.mjs` records source/code hashes and per-frame states, inliers, reprojection, projected
anchor and processing time in `replay-summary.json`. The input is the camera rectangle extracted
at 360×640, 10 fps; evaluated frames cover 2.0–11.9 seconds. This is screen capture, **not raw camera
frames**: the already-rendered model and center cross contaminate the input.

The current visual tracker accepts 64/100 frames, including local recovery at 10.0 and 11.5 seconds. The rigid session, using an explicitly artificial
frontoparallel gravity prior, accepts 43/100: continuous tracking at 2.0–4.0 seconds, rejection
through hand occlusion, recovery at 5.2, 6.5 and 7.1 seconds. The original anchor and
reference persist throughout, with no reposition. The rigid session remains recovering from 8.1–11.9 seconds despite later visual matches; those do not pass the pose/consensus gates under the assumed gravity.
This limitation is not hidden by retaining an indefinitely frozen model.

A limited legacy primitive comparison accepts 39/100 frames, but loses the initial continuous
track at 2.6 seconds. It uses assumed identity rotation and does not reproduce the old session's
reference deletion. **Acceptance counts are not accuracy scores**, and the new tracker is not
claimed superior on a whole-video accuracy metric. The demonstrated improvements are continuity
through the initial movement and recovery without replacing placement.

A repeat on desktop Node 26.7.0 arm64 measured about 13.6 ms mean / 36.9 ms p95 for the rigid session,
excluding capture, Worker transfer and rendering. Earlier timing varied with desktop load.
Neither number predicts sustained iPhone performance. No ground-truth pose error, metric scale,
thermal stability or physical lifecycle result can be inferred from this replay.

## Next physical test

Open the current full join link in Safari on the iPhone, reload, allow camera/motion, keep portrait,
and tap a textured matte table while still. Move slowly left/right and closer/farther. Briefly
cover the region with a hand, remove it and return to the same view without tapping. Observe
whether the apartment returns to the same place, whether its size jumps, and whether recovery
works repeatedly. Stop and explicitly send the result (or download JSON). Exact loaded build,
recovery reasons, inlier counts and recent trace are then available for diagnosis.

This remains an unsupported lab experiment; physical acceptance and publication gates are open.
Implementation rationale and primary sources: [tracking research](../tabletop-tracking-research.md).
