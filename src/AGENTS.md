# Runtime and public API

Applies to `src/`. Read the root instructions first.

- Keep the core framework-neutral; heavy backends/renderers must be optional and loaded on demand.
- `index.ts` is the intentional public entry point. Export only a reviewed, documented API.
  Do not add placeholder functions/types merely to fill a proposed architecture.
- No import-time browser globals, permissions, camera startup, listeners, timers or GPU allocation.
- Session-owned camera tracks, listeners, timers, workers and rendering resources need cleanup on
  failure, close and repeated open/close. Abort obsolete asynchronous work.
- Detect capabilities, not just browser names. Unsupported/degraded states must be explicit.
- Separate orientation-only viewing, image tracking and world tracking. Do not silently substitute
  a native viewer or marker flow for an in-browser markerless experience.
- Treat exports, declarations, documented behavior, events/errors, asset paths and supported
  browser/toolchain requirements as compatibility concerns; follow `../docs/maintenance.md`.
- Add behavioral tests when implementing behavior. Package tests establish packaging only;
  physical AR claims require device/OS/browser evidence and documented limitations.
- No runtime engine is selected yet. Record dependency provenance and rights before introducing one.
