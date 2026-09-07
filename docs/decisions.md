# Current decisions

## Accepted implementation scope — 2026-09-07

The supplied Browser AR implementation brief authorizes M0 foundations and M1 spikes now.
G1 and G2 require physical evidence before M2; no later milestone is implemented in this change.
The final handoff's stricter prerequisite (both G1 and G2) resolves the M2 table listing only M1a.

- Spatial and `@arquiveapp` replace the brief's placeholder `tabletop-ar` names. Scope ownership
  is still unverified; all five npm workspaces remain `private: true`, version `0.0.0`.
- MIT remains the established original-code licence (the brief explicitly offers it as an
  alternative). No existing code is relicensed. No third-party rights are inferred from MIT.
- The brief's monorepo boundaries are now needed: core, WebXR, vio-lite and three renderer;
  root Spatial is a façade. Only the M0 capability probe is implemented as public API.
- The supplied generic AGENTS template is adapted into the repository's existing scoped
  instructions. Local rights/SBOM checks replace its CI references; no hosted CI/CD is added.
- WebXR is the selected first backend direction. The first-party planar tracker is an
  experimental research direction; neither selection establishes device support.
- Emscripten 6.0.2 is verified and pinned by manifest digest. Base/SIMD diagnostic WASM is built
  locally from original source; no prebuilt binaries enter Git or npm artifacts.
- OpenCV 4.13.0, Eigen 3.4.0, Sophus, wasm-feature-detect and three.js are proposed future
  dependencies, not adopted, audited shipping components. The M1 kernel and diagnostic need
  none of them. Rights review must precede adding them. No production tracking code is present.
- Stage 2, relocalisation, threaded WASM, WebGPU, image targets, framework bindings, hosted
  services, model protection and all supported claims remain outside this starting scope.

## What exists versus what still needs evidence

Implemented: workspace packaging; prompt-free capability detection; rights inventory checks;
base/SIMD luma diagnostic builds; WebXR lab page; ImageBitmap/canvas capture measurement path;
gyro + direct single-plane patch prototype; local metric exports; synthetic regression tests.

Pending engineering: TrackProcessor/VideoFrame capture paths; independently calibrated sensor
axes, camera intrinsics and camera/IMU offset; ground-truth recording/alignment; robust tracker
outlier rejection, yaw correction and patch expansion. These are not implemented features.

Blocked on physical lab access: all G1/G2/M1c measurements, target acceptance, 20-cycle device
leaks, sustained capture/thermal tests. This run cannot supply a physical table, independent ground truth or operator-controlled
phone motions. Desktop browser failure without XR hardware is an expected
negative-path test, not a failed G1 device test. Untested G2 is neither pass nor failure; the
fallback-only policy applies if G2/G3 actually fail after measurement.

The milestones and evidence requirements are maintained in [validation](validation.md).
