# Tabletop tracking repair research

Research and implementation review: 2026-09-07, two rounds. Applies to the private-fixture
browser lab, not the published API. The user's recordings demonstrated a failed experience: the
model collapsing over a moving hand and failing to recover (first recording), then repeatedly
disappearing and reappearing while the phone looked around a floor (second recording). Neither
recording qualifies a device.

## Findings and primary sources

The original tracker optimized three translation values over a small direct-intensity patch, with
rotation forced from delivery-timed gyro samples, and erased placement after three rejected frames.
The first repair replaced it with distributed features, robust homography fitting and a retained
reference, but kept a single fixed feature set, no motion prediction and a hide/show presentation.
An independent numerical review of that version confirmed: conventions and pose extraction are
correct to numerical precision; tracking is lost once about 63% of the tapped region leaves the
view and cannot resume until it returns; optical flow captures about 16–18 px per processed frame
(roughly 55–60°/s at 30 fps); and after one dropped frame the confirm-and-roll-back logic could not
reacquire at ≥1.5° of rotation per frame. See the
[second recording review](evidence/2026-09-07-tabletop-recording-2-review.md).

- [Google Research: Instant Motion Tracking](https://arxiv.org/pdf/1907.06796) motivates the split
  used here: the gyroscope handles rotation prediction and short visual gaps; the visual planar
  region handles translation and drift. This lab is not a reproduction of that system or of its
  reported performance.
- [OpenCV's official LK homography example](https://github.com/opencv/opencv/blob/4.x/samples/python/lk_homography.py)
  demonstrates pyramidal feature flow, forward/backward checks and robust homography estimation.
  [Shi–Tomasi documentation](https://docs.opencv.org/4.13.0/d4/d8c/tutorial_py_shi_tomasi.html)
  explains selecting corners from the smaller gradient-covariance eigenvalue. These inform our
  original implementation; OpenCV code/binaries are not added as a dependency.
- [W3C Device Orientation and Motion](https://www.w3.org/TR/orientation-event/) defines device
  coordinates, acceleration/rotation events and the `interval` property used for integration.
  Event delivery is not camera/IMU calibration.
  [requestVideoFrameCallback](https://wicg.github.io/video-rvfc/) distinguishes presentation,
  media and capture timing. The lab records provenance and does not invent an exposure timestamp
  when captureTime is unavailable.
- [WebKit: Safari 27 beta](https://webkit.org/blog/17967/news-from-wwdc26-webkit-in-safari-27-beta/)
  (June 2026) adds the `<model>` element and fixes a WebXR viewport bug but announces no
  handheld `immersive-ar` session for iPhone. `<model>` is a platform viewer path, excluded by the
  agreed in-page contract. No dependency-free in-page alternative to a first-party tracker exists
  on iOS Safari today; proprietary hosted services were not adopted.

## Implemented design

`FeaturePlane` is now an extendable planar map. The placement image parameterizes the plane:
each feature stores its reference-pixel position plus fine and coarse appearance templates taken
from the frame that created it, with the creation homography, so verification samples the current
image through the exact plane mapping. Up to 80 Shi–Tomasi corners initialize the map inside a
region around the tap; as tracking proceeds, image cells with fewer than three inliers receive new
corners back-projected onto the plane (at most 12 per frame, 160 features total). Off-screen
features are evicted least-recently-seen when the map is full, except a reserve of 40 original
tapped-region features. Features that repeatedly fail consensus while visible (moving hand,
off-plane objects) are pruned. Consequently the model no longer requires the tapped region to stay
in view; it requires that some part of the same plane remains visible.

Tracking is frame-to-frame pyramidal Lucas–Kanade (zero-mean, gain-normalized patches, forward and
backward checks) seeded by a **predicted** homography: the gyroscope's scene rotation since the
last accepted frame, mapped to the image as K·R·K⁻¹. RANSAC fits the reference→current
homography; inliers are verified against their own creation templates; acceptance requires
spatial support in the current image (≥2% of the frame area over ≥4 grid cells), no fold or
horizon crossing, bounded motion relative to the prediction and gradual apparent scale change.
After sustained loss, a 13×13×3 coarse search around the predicted seed ranks hypotheses by the
features' coarse templates and refines two of them through the same gates. Pyramid buffers are
pooled; an accepted fit that the rigid session later rejects is restored, including the removal
of any features it created.

`TrackingSession` averages the gravity vector over the last 500 ms and requires a steady phone
before placement. It integrates gyroscope samples with the W3C `interval`, accumulates rotation
since the last accepted frame for four camera-versus-motion delivery offsets (0/30/60/90 ms),
compares each against the visual rotation and reports the residual ratio. Prediction is disabled
automatically when the residual exceeds 60% of the gyro rotation over 30 moving frames, and the
best-agreeing offset is adopted. When visual consensus fails, or a pose awaits confirmation, the
session emits a **bridging** pose for at most 1.5 s: the last measured pose rotated by the gyro,
translation held, flagged `predicted: true`. A visual pose consistent with that prediction is
accepted immediately; an inconsistent one still needs two agreeing observations, and a
180-degree branch switch is still rejected. Recovery reports the visible anchor jump in pixels.

The renderer shows measured poses at full opacity and bridged poses dimmed, so a short loss no
longer blinks the model. When prediction is validated, the render loop rotates the camera by the
gyro motion between the tracked frame's delivery time and display time (rotation only, ≤250 ms)
and pose smoothing drops from 45 ms to 25 ms. Diagnostics add loss intervals with recovery jumps,
stationary jitter (processing-resolution pixels while the gyro reports <3°/s), pose age at render,
gyro consistency per offset and a live on-screen status line.

### Second device round

The first on-device diagnostics (`SP-85385458`, `SP-C1116A35`) changed two assumptions. iOS
Safari reports `DeviceMotionEvent.interval` in seconds, so gyro dt now comes from delivery
timestamps. The derived axis mapping `[-beta, +gamma, +alpha]` disagreed with the visual rotation
by 131% on the iPhone 16, so the session scores all 48 signed axis permutations times four delivery
offsets against the visual rotation on moving frames and adopts the agreeing one; prediction is
`active` only below a 0.5 residual ratio, and while unvalidated a loss is bridged by a frozen pose
for 0.7 s. A scanning stage now precedes placement: a provisional map starts at the view centre when
the phone aims down steadily, the surface is ready after 20 tracked frames with ≥50 features and
measurable motion, and a tap anchors through the current homography inside that map; reposition
keeps the map. The withheld pose during confirmation no longer rolls back the flow reference, a pose
within 0.2 rad / 0.15 of the last one is accepted at once after loss, and coarse recovery is bounded
to alternate lost frames, 16 features and a 9×9×3 grid (~2 ms per lost frame in Node).

## Evidence and remaining limits

Deterministic tests cover a pan that moves the tapped region completely out of view and back, a
44 px jump that succeeds only with a predicted seed, restore of a rejected frame's features and
pyramid, a moving textured foreground object across 40 frames, gyro-seeded rotation with a bridged
occlusion and same-anchor recovery, and steady-gravity placement. Node processing on Apple silicon
measured about 4.5 ms mean and 6.4 ms p95 per 360×640 frame with a 160-feature map, versus
13.6 ms mean for the previous tracker; phone cost is unmeasured. A private replay of the first
recording's screen-capture crop now accepts 79 of 100 frames with continuous tracking from 2.0 s
to 6.7 s through the hand crossing (previously 64, losing at 4.0 s); this remains contaminated
input with no ground truth. A desktop Chromium synthetic replay exercised placement, map growth to
about 150 features, bridged occlusion and recovery through the real Worker/WASM/GLB renderer and
was received as `SP-6ABF7427`; it is not a device test.

Intrinsics remain an assumed 65-degree long-edge field of view; plane distance is 0.65 m and
model extent is 0.3 m before the size control. Rigid-pose rejection is expected to rise with
large viewpoint changes when the true focal length differs; the report's `poseReprojectionError`
trend will show this. No metric scale, multi-plane scene, general relocalization, rolling-shutter
compensation or camera/IMU time calibration is implemented; the delivery offset is selected from
four coarse candidates. The gyro axis mapping is validated online, not calibrated. Blank/glossy
tables, very fast motion and leaving the plane entirely still fail. No package publication or
support promotion is authorized by this repair.
