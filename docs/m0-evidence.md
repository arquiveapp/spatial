# M0 and M1 preparation: local evidence, 2026-09-07

This record covers local foundations and experimental lab plumbing only. It is not physical
G1/G2/G3 evidence and does not authorize M2 or release. Refer to the commit containing this file
for the source revision; the earlier desktop lab used a dirty working tree during development.

## Executed

- Host tools: Node 26.7.0, npm 11.19.0, Docker server 29.6.1. Node 24 is the documented preferred
  development version but was not used in this run. No browser/device compatibility follows.
- Clean `npm ci`, generated package output cleanup, then `npm run check`: passed. Eleven
  behavioral tests passed, including a 20-cycle **mocked** XR resource test, late fulfillment,
  denied XR permission, policy/rejected probes, synthetic gyro/patch checks and rights rejection.
- Packed all five workspaces/façade artifacts and installed them together into an isolated
  consumer. Browser-free ESM import and NodeNext/Bundler root API declarations passed.
- Rights gate: 29 exact lockfile development entries; zero external npm runtime or compiled
  tracking dependencies. Non-host optional TypeScript binaries were not installed/audited.
  Installed CycloneDX 1.5 inventory emitted successfully, 14 components.
- Emscripten 6.0.2 image digest and linux/arm64 platform recorded in toolchain.json. Two local
  builds produced identical SHA-256 values: base
  `4c0cc16d98be7a8c1e1f7d1dbef900d95f32740c3b9488e547327a477ff9a860`, SIMD
  `23cab138655591b58d45d7961d9d98714cd37a5c0ca2506945cf09e0e23c4b5f`.
  Full 640×360 frame checksums and out-of-bounds rejection passed in Node for both variants.
- Codex in-app desktop browser at `http://127.0.0.1:4178`: correct page/title, meaningful first
  screen, no framework overlay or relevant console warnings/errors. Detect capabilities updated
  the visible report without prompting. WebXR start reported No XR hardware found and restored
  controls. This is a negative-path desktop check, not a physical G1 failure.
- Browser synthetic button transferred an original solid-red ImageBitmap into a real Worker,
  ran each WASM variant and returned checksum 17,510,400 for each. No camera or physical input.
  Desktop and 390×844 layouts visually inspected; no clipping/overlap observed.

## Not run / incomplete

Physical camera or motion permission/capture, Android plane/anchor placement, iOS sensor axes,
latency/jitter/drift reference comparisons, preferred TrackProcessor capture paths, physical
20-cycle leaks, five/ten-minute sustained tests, iframe policies on devices and all support
qualification. No npm publication, release tag, hosted deployment or ARchive integration.
The M1 prototype needs those measurements and the remaining engineering documented in
[limitations](../KNOWN_LIMITATIONS.md); its synthetic pass is not stable tabletop AR proof.
