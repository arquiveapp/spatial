# Second on-device tabletop diagnostic — 2026-09-07

Receipt `SP-C1116A35`, iPhone 16 (user-entered), UA iOS 18_7, Safari 27.0, build `9afddb4`
(`dirty:false`), kind `tabletop`, 64.6 s, 7 taps, size 1.9×. On-device telemetry, not a gate.
The user: "melhorou, mas continua desaparecendo, reposicionando, e parece que ele não liga; eu
só clico para ele aparecer, enquanto nativamente precisa passar pela superfície" (improved, but
still disappears and repositions; it never "turns on" by itself; native AR needs a surface sweep).

## What the telemetry shows

| Metric                     | `SP-85385458` (19cd84a) | `SP-C1116A35` (9afddb4) |
| -------------------------- | ----------------------- | ----------------------- |
| gyro.prediction            | untested (dt bug)       | disabled-inconsistent   |
| gyro.residualRatio         | n/a                     | 1.31 at every offset    |
| gyro.frames scored         | 0                       | 368                     |
| processed / dropped frames | 1162 / 711              | 1074 / 747              |
| engineMs mean / p95        | 31 / 58                 | 35.5 / 61               |
| stateFrames bridging       | 212                     | 23                      |
| stateFrames recovering     | 98                      | 406                     |
| loss intervals             | 25                      | 14 (up to 4.1 s)        |
| stationaryJitterPx samples | 550 (p50 8.2)           | 0 (never still)         |

1. **The gyroscope now integrates, and the assumed axis mapping is wrong on this phone.** The
   dt fix worked (368 scored frames, `motionDegPerS` up to 2.6). But the visual rotation and the
   gyro rotation under the derived mapping `[-beta, +gamma, +alpha]` disagree by 131% of the gyro
   magnitude, identically for 0/30/60/90 ms delivery offsets. Identical residuals across offsets
   rule out timing; a sign or permutation error in the device→camera axis mapping remains. The
   consistency gate correctly disabled prediction.
2. **Disabling prediction also disabled bridging**, so every visual loss hid the model at once and
   showed the recovery coaching (406 recovering frames, 14 losses up to 4.1 s). This is what
   "disappears and asks to be placed again" looks like.
3. **Frame drops did not improve** (~41% processed, engine 35 ms mean). The optical-flow budget
   was not the bottleneck; the lost-frame path (coarse recovery search of 507 hypotheses on
   every lost frame, ~40% of the session) was, together with the fixed per-frame cost.
4. **Confirmation after loss** still withheld the first good pose and rolled back the flow
   reference (`confirming-reference` on most recoveries), delaying reacquisition.
5. **No surface-scanning stage.** Placement was accepted on any tap against a single fresh frame.
   The user expected the native flow: sweep the surface, then be offered placement.

## Changes made in response (build after `9afddb4`)

- Online selection of the gyro axis mapping: all 48 signed permutations and 4 delivery offsets
  are scored against the measured visual rotation; the agreeing one is adopted (`gyro.mapping`),
  prediction becomes `active` only when its residual ratio is below 0.5. Two tests cover the
  derived mapping and a deliberately different one.
- When the mapping is not validated, short losses are bridged by a frozen pose for 0.7 s
  (`frozen:true`) instead of hiding immediately.
- Scanning stage: a provisional plane map starts when the phone aims down steadily, the surface
  is "ready" after 20 tracked frames with ≥50 features and some motion, and a tap then anchors
  through the current homography inside that map (no fresh reference). Reposition keeps the map.
  Taps before readiness are refused with coaching and counted (`tapsBeforeReady`).
- The withheld pose during confirmation no longer rolls back the flow reference; a pose within
  0.2 rad / 0.15 of the last one is accepted at once after loss.
- Coarse recovery runs on alternate lost frames with ≤16 features and a 9×9×3 grid; per-phase
  timings (`phaseMs.pyramidMs/flowMs/recoveryMs`) are reported.

These remain unverified on the phone. The next run should show `gyro.prediction:"active"` with a
named `gyro.mapping`, more processed frames, fewer and shorter loss intervals, and the scanning
reticle turning solid before the first tap.
