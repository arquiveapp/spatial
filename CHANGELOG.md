# Changelog

No version has been released to npm. Changes are maintained for humans, with versioning governed
by [the maintenance policy](https://github.com/arquiveapp/spatial/blob/main/docs/maintenance.md).

## Unreleased

### Changed

- Repair experimental tabletop tracking after failed phone footage: distributed feature flow,
  exposure normalization, robust rigid pose, persistent reference recovery and rejection of
  foreground collapse/orientation jumps. Rejected fits cannot change the next prediction.
- Keep recent diagnostic frames and add a browser replay with exposure changes/occlusion.
  Recording-derived replay shows partial improvement; the final segment still loses tracking.
  Physical iPhone validation and publication remain pending.

### Added

- Complete experimental tabletop lab flow: portrait camera/Worker tracking drives GLB placement,
  repositioning, scale and rotation, with explicit loss handling and synthetic renderer replay.
- Preliminary iPhone feedback analysis; correct report validation for scale/luma dimensions and
  preserve runtime errors. Public packages remain private and their runtime API is unchanged.

- Phone-test laboratory with optional temporary HTTPS access, local-only GLB fixtures, explicit
  non-AR viewer/experimental WebXR model placement, and receipt-based diagnostic submission to
  the Mac. No camera uploads or changes to the public renderer API.

- Local TypeScript/ESM package scaffold and declaration generation.
- Packed-consumer checks and narrow distribution contents.
- Main-based local release/versioning guidance and scoped agent instructions.

- Unpublished core, WebXR, vio-lite and renderer workspaces; Spatial keeps its original package
  name and re-exports the prompt-free `probe()` capability API.
- Local rights inventory/hash gate and digest-pinned base/SIMD diagnostic builds.
- M1 device lab: WebXR cube, ImageBitmap/canvas capture metrics, experimental gyro/planar patch
  fit and explicit local JSON export; synthetic tests are not physical evidence.
- Untested support matrix, known limitations and physical qualification procedure.

No production AR session/renderer API, physical support claim, release or npm publication.
No existing public export was removed. Reserved backend workspaces remain unavailable until M1
physical gates pass; TrackProcessor capture and reference measurement tooling remain pending.
