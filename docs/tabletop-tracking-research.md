# Tabletop tracking repair research

Research and implementation review: 2026-09-07. Applies to the private-fixture browser lab,
not the published API. The user's recording demonstrated a failed experience, including model
collapse over a moving hand and failure to recover. It does not qualify a device.

## Findings and primary sources

The old tracker optimized three translation values over a small direct-intensity patch, with
rotation forced from delivery-timed gyro samples. Three rejected frames erased placement.
It lacked distributed feature consensus, exposure normalization and reference recovery.

- [Google Research: Instant Motion Tracking](https://arxiv.org/pdf/1907.06796) describes persistent
  feature tracks, spatial motion consensus and rigid perspective fitting. It distinguishes planar
  tracking from full SLAM. Our previous direct patch was not an implementation of that system;
  the new lab is also not a reproduction of its complete pipeline or performance results.
- [OpenCV's official LK homography example](https://github.com/opencv/opencv/blob/4.x/samples/python/lk_homography.py)
  demonstrates pyramidal feature flow, forward/backward checks and robust homography estimation.
  [Shi–Tomasi documentation](https://docs.opencv.org/4.13.0/d4/d8c/tutorial_py_shi_tomasi.html)
  explains selecting corners from the smaller gradient-covariance eigenvalue. These inform our
  original implementation; OpenCV code/binaries are not added as a dependency.
- [W3C Device Orientation and Motion](https://www.w3.org/TR/orientation-event/) defines device
  coordinates and acceleration/rotation events. Event delivery is not camera/IMU calibration.
  [requestVideoFrameCallback](https://wicg.github.io/video-rvfc/) distinguishes presentation,
  media and capture timing. The lab records provenance and does not invent an exposure timestamp
  when captureTime is unavailable.

## Implemented design

`FeaturePlane` selects up to 80 spatially distributed Shi–Tomasi corners in a wider region around
placement. Contrast-balanced selection prevents one bright object from suppressing weaker table
features. Three-level Lucas–Kanade uses zero-mean, gain-normalized patches. Forward/backward
error, RANSAC, reference appearance, spatial support, orientation and projected-area checks
reject inconsistent matches. After sustained loss, a bounded 9×9×3 translation/scale search
ranks coarse reference appearance and refines only two seeds through the same acceptance gates.
The original reference stays immutable until explicit reposition.

`TrackingSession` obtains the initial plane direction from gravity, then derives image rotation
and translation from the homography. For pixel homography H and intrinsics K,
B = K^-1 H K = s(R + (t/d)n^T). Tangent directions orthogonal to n eliminate translation;
a 3×2 polar orthonormalization recovers a proper rotation. Translation follows from the remaining
normal component. Rigid reprojection, conditioning and cheirality gates reject incompatible
fits. Synthetic tests include tilted planes and actual WebGL projection of the anchor.

Temporal gates reject abrupt depth/orientation changes. Recovery needs two consecutive agreeing
poses. Gross orientation branch switches remain rejected: a homography alone cannot distinguish
all 180-degree projective ambiguities. Rejected poses roll back optical-flow prediction as well,
so an invalid fit cannot poison the next frame. These are chosen experimental thresholds, not
measured physical error bounds.

The renderer keeps scale fixed to the user's control; it never fits model scale to a foreground
object. Camera pose has a 45 ms display smoothing time constant. One rejected frame can retain
the previous display for at most 120 ms; longer loss hides the model and requests return to the
same region. A stale accepted pose expires after 250 ms. Smoothing/holding are presentation
behavior, not new tracking observations. Worker tracking is JavaScript; WASM still converts luma.

Diagnostics include feature/inlier counts, reprojection, recovery reasons and separate clock
provenance. A bounded, sampled recent trace preserves the end of the test instead of filling
entirely before placement. Sending/downloading remains explicit and excludes camera images.

## Evidence and remaining limits

See [recording review](evidence/2026-09-07-tabletop-video-review.md) for observed failures and
limited replay results. Deterministic tests exercise exposure change, partial/full occlusion,
weak texture, foreground shrink, recovery, projective geometry and rejected-fit rollback. The
browser synthetic fixture includes periodic exposure variation and two-second occlusion through
the real Worker/WASM/GLB renderer path. Neither establishes phone tracking accuracy.

Intrinsics remain an assumed 65-degree long-edge field of view; plane distance is 0.65 m and
model extent is approximately 0.3 m. Initial gravity is not calibrated or independently verified.
No metric scale, scene reconstruction, plane expansion, multi-keyframe map, general relocalization,
rolling-shutter compensation or camera/IMU alignment is implemented. Reacquisition is local to
the original visual reference. Blank/glossy tables, rapid motion and large viewpoint changes can
still fail. No package publication or support promotion is authorized by this repair.
