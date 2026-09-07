# Local validation and physical lab procedure

## Gate state

| Gate                           | Current status                                                               | Required next evidence                                      |
| ------------------------------ | ---------------------------------------------------------------------------- | ----------------------------------------------------------- |
| G0 current distribution rights | Local automated gate; zero third-party runtime/compiled tracker dependencies | Repeat exact-source review before any adoption              |
| M0 toolchain                   | Digest-pinned 6.0.2, base/SIMD source builds                                 | Rebuild comparison with `build:wasm`                        |
| G1 Android WebXR               | NOT RUN on phones                                                            | Two physical Androids, including 2019-class ARCore          |
| G2 iOS capture                 | One preliminary iPhone run; NOT PASSED                                       | Two physical iPhones, iOS Safari; additional iOS Chrome run |
| M1c tracking feasibility       | Preliminary patch feedback; no ground truth                                  | Physical static jitter and walk-around against reference    |
| G3 Stage 1 quality             | NOT RUN; M3 not implemented                                                  | Three iPhones and two non-WebXR Androids                    |
| G4 supported row               | BLOCKED by missing evidence                                                  | Full row qualification below                                |

M2 cannot start until G1 and G2 have recorded results and passed. A desktop, mocked session,
WASM checksum or package test cannot satisfy either. Do not turn missing hardware into a FAIL
measurement or invoke the G2 fallback decision without a real failed measurement.

## Prepare the lab

1. `npm ci && npm run check`, then `npm run build:wasm && npm run test:wasm`.
2. Repeat `npm run build:wasm` and compare the hashes in `tools/devlab/generated/build.json`.
   The compiler runs with network disabled, fixed source path/epoch and the recorded image
   digest/platform. Cross-platform bit-for-bit equivalence is not claimed.
3. `npm run devlab` starts the loopback lab, default port 4178. Set
   `SPATIAL_LAB_PORT` to use another unused port. Never take over an existing listener.
4. For phones serve the allowlisted lab files, generated WASM and core `dist/index.js` through
   your own trusted HTTPS origin; supply `/lab-build.json` with the exact clean Git commit and
   `dirty: false`. Keep the same absolute paths. The local server intentionally exposes no
   arbitrary repository files or a LAN listener. Its explicit-action POST receiver stores diagnostic
   reports locally. The optional [phone-lab tunnel](mobile-lab.md) automates HTTPS access for local testing;
   it is not required by the library. Preserve [toolchain notices](../THIRD_PARTY_NOTICES.md).
5. Cross-origin embedding needs camera, accelerometer, gyroscope and xr-spatial-tracking policy
   grants from the embedding site. Record both allowed and denied iframe cases. Camera access
   requires a secure context; do not bypass a TLS warning to run the experiment.

## Execute and record

First click Detect capabilities. Enter actual device, OS and browser builds. Start the desired
experiment from its button; permission denial is an outcome, never auto-retried.

- **M1a:** use a textured horizontal table, scan and tap to place a 16 cm cube. Record time to
  first valid hit, anchor availability, optional DOM overlay, tracking loss/recovery and a 3 m
  loop returning to the start. The JSON contains raw anchor transforms/time but no reference
  measurement. A cube drawn at a hit point before tapping is a preview, not an anchor.
- **M1b:** run five minutes. Requested camera is 1280×720; record actual dimensions/settings.
  Worker preserves aspect at a maximum of 640 pixels on the long edge and 230,400 total pixels (360×640 for portrait 9:16). Export actual path, SIMD/base, fps, dropped bursts per 10 s,
  worker/round-trip p50/p95, captureTime availability, IMU count/rate/jitter and observations.
  Pass target: >=24 processed fps, <1 dropped burst/10 s, approximately 60 Hz IMU with measured
  jitter. Hardware acceptance remains manual. Preferred TrackProcessor paths are pending;
  current results qualify only the path named in the JSON. Record thermal warnings manually.
- **M1c:** hold still, aim at a textured horizontal surface, tap a patch. Fit marker/relative
  pose is diagnostic only. Record ten seconds static and the 3 m loop with patch in view.
  Use the independent reference methodology below; do not convert relative units into mm by
  renaming fields. Abort on loss, restart after rotation/backgrounding.

Stop before export. Download is local and explicit. No export is automatically physical evidence
or a PASS. Legacy diagnostics retain up to 36,000 trace samples; tabletop retains 1,200 and outgoing reports sample to at most 600. These reduced exports are not complete replay recordings.
The exported record is described by `tools/devlab/result.schema.json`; `physicalEvidence` is
always false until a human-reviewed evidence document establishes physical provenance.
Raw customer imagery, private models and sensitive user identifiers must never enter Git.

## Independent reference and scenario checklist

Use a printed AprilTag/ChArUco board outside the placement patch, an independently reviewed
recording path and offline reference poses with calibrated intrinsics. This reference tooling
is **not implemented** here. Align relative trajectories with Sim(3), metric trajectories with
SE(3). Record the relative scale factor as an observation. Board visibility and print/calibration
accuracy constrain the reference. Use an external 240 fps screen recording for screen jitter and
motion-to-photon proxy; a rendered marker alone cannot establish world accuracy.

Run: ~20 lux, blank white/glossy/glass table, moving person, notification/call interruption,
background 30 s/return, portrait-landscape-return, permission denied/dismissed/previously blocked,
camera occupied, iframes with/without grants, 20 open/close cycles, ten-minute soak. Explicit
orientation-preview/viewer fallback testing is pending their M2 implementation.

Record init success fraction, seconds to first hit, ten-second jitter (px at 1080p equivalent and
mm only with reference), 3 m loop drift, lens-cover loss/recovery within five seconds, engine and
render p50/p95, minute 1/5/10 trends, battery/temperature observations and JS/WASM/GPU leak evidence.
Targets from the brief remain targets: WebXR/vio init >=95/85%; placement <=3/5 s; jitter <=2/4 px
and <=2/5 mm; loop drift <=2/5%; recovery >=90/70%; experimental engine <=20 ms p95; sustained
frame time degradation <=25%; WASM <=128 MB and no growth trend over 20 cycles.

A supported device/browser row requires two independent physical runs on different days, exact
OS/browser builds and clean commit, every scenario, met targets or explicit justified exceptions,
no open P0/P1 and its known limitations. Experimental rows require the two dated physical runs.
A result schema, unreviewed export or synthetic test can never promote a row automatically.

## References checked 2026-09-07

[WebXR](https://www.w3.org/TR/webxr/), [hit testing](https://www.w3.org/TR/webxr-hit-test-1/),
[Emscripten installation](https://emscripten.org/docs/getting_started/downloads.html),
[instant motion tracking paper](https://arxiv.org/abs/1907.06796).
The paper motivates the research split; its reported performance is not Spatial performance.
