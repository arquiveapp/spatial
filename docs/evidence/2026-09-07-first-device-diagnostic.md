# First on-device tabletop diagnostic — 2026-09-07

Receipt `SP-85385458`, the first genuine phone diagnostic for the plane-map tracker (earlier
tabletop reports were desktop synthetic replays). This is on-device telemetry, not a passed gate.

## Provenance

| Field   | Value                                                                 |
| ------- | --------------------------------------------------------------------- |
| Device  | iPhone 16 (user-entered), UA iOS 18_7, Safari 27.0, rear camera       |
| Build   | `19cd84a`, `dirty:false`, kind `tabletop`, `synthetic:false`          |
| Camera  | 720×1280 portrait at 30 fps; processed 360×640; captureTime available |
| WASM    | base kernel, SIMD false; motion permission granted                    |
| Session | 65.7 s, 4 placements, size ~1.3–2.4×                                  |

The user's words: "não consegue ficar parado, fica toda hora querendo ser placeble... e não
funciona bem" (it cannot hold still, keeps returning to the place-it state). The paired 51 s
recording (`ScreenRecording_09-07-2026 17-14-53_1.MP4`, kept out of Git) shows the apartment
rendering on the parquet floor but wobbling while nominally still and dropping to the recovery
coaching repeatedly, with the debug line reading `giro untested` throughout.

## Confirmed causes from telemetry

1. **The gyroscope never drove prediction on the device.** `gyro.prediction:"untested"`,
   `gyro.frames:0`, `motionDegPerS≈0.007` despite 3497 samples and constant motion. iOS Safari
   reports `DeviceMotionEvent.interval` in seconds (~0.016), and the code divided it as if
   milliseconds, so the integration step was about 1.6e-5 s and accumulated essentially zero
   rotation. Prediction activation requires accumulated rotation, so seeding, bridging and
   render-time extrapolation were all inert. The tracker ran as pure vision with no motion model.
2. **About 61% of frames were dropped; effective rate ≈ 18 fps.** `frames:1162`,
   `droppedFrames:711`, `engineMs.mean:31, p95:58`, `roundTripMs.p95:65`. Worker time near the
   33 ms frame budget plus back-pressure halved the processed rate, which doubles inter-frame
   image motion and pushes the visual capture range, explaining the `insufficient-background-consensus`
   losses (most of the 25 recorded loss intervals) even at moderate hand speed.
3. **Large stationary jitter.** `stationaryJitterPx` mean 13.6, p50 8.2, p95 47.7 at 360-wide
   processing (multiply by 3 for a 1080p-equivalent: p50 ≈ 25 px, p95 ≈ 143 px). Independent
   per-frame pose estimates with only 25 ms smoothing let the tall model swim while the phone
   was still. `poseAgeAtRenderMs` mean 72, p95 117.
4. **Frequent recover/re-place.** `recoveries:22`, 25 loss intervals, recovery jumps to ~89 px,
   several `non-rigid-or-ambiguous-pose`. Each hide plus the "aponte para a mesa" coaching reads
   as the app "wanting to be placed again". `stateFrames`: tracking 752, bridging 212, recovering
   98, unplaced 100.

## Fixes applied (same session, build after `19cd84a`)

- Gyro `dt` is derived from delivery timestamps, not the ambiguous `interval`, in both the tracker
  and the render-loop extrapolation. This revives prediction, seeding, bridging and extrapolation.
  A regression test integrates the same rotation for `interval` given in ms, iOS seconds or absent.
- Render smoothing is adaptive: a long time constant (~220 ms) with a rotation/position deadband
  when the gyro reports the phone is nearly still, collapsing toward ~20 ms once it moves.
- Optical flow runs on a cell-distributed budget of 90 features per frame (map cap 130), cutting
  per-frame cost to raise the processed frame rate; Node processing fell to ~7 ms mean / 10 ms p95.

These target the three measured causes directly. They remain unverified on the phone; the next
device run should show `gyro.prediction:"active"`, higher processed fps, lower `stationaryJitterPx`
and fewer loss intervals.
