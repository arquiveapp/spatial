# Spatial — agent instructions

## Scope and current stage

This is a standalone public library, not the ARchive application or API. The current scope is
package infrastructure while tracking research is pending. Do not infer authorization to
implement an engine from this scaffold. Keep runtime APIs and backend selection uncommitted
until an implementation brief establishes them.

The library must not require an ARchive account, backend, catalogue, secret, hosted tracking
service or mandatory external native-viewer handoff. Models belong to consuming applications.
Never copy private workspace files, customer assets or credentials into this public repository.
Unrelated parent-workspace authentication instructions do not establish requirements for this library.

## Dependency rights

- Original code is MIT; third-party licences are never replaced by the root licence.
- Before adding or upgrading a dependency, inspect its exact version, licence, provenance,
  transitive dependencies and distributed contents. Record findings in `docs/dependencies.md`.
- Include native code compiled into WASM, examples copied into source, models, weights and data
  in the review. Distinguish development tools from code shipped to consumers.
- Preserve required notices, attribution and corresponding source/build materials.
- Permissive commercial and proprietary downstream adoption is the intended contract.
  Do not ship GPL, other copyleft, source-available, noncommercial or proprietary components
  without an explicit documented distribution decision consistent with that contract.
- A wrapper, Worker, dynamic import, iframe or separate package is not assumed to eliminate
  licence obligations. Never relabel restricted code. Escalate a material rights conflict with
  a recommended alternative rather than silently changing consumer rights.

## Engineering

- Keep the core framework-neutral. Importing it must not touch browser globals, ask for
  permissions, start a camera, register global listeners or allocate a renderer.
- `src/index.ts` is the deliberate public entry point. Export only reviewed public API here.
- Load optional heavy code only when needed. Camera, listeners, timers, workers, textures and
  rendering contexts need explicit lifecycle and cleanup once implemented.
- Detect capabilities, not just user-agent names. Report unsupported/degraded states honestly.
- Do not claim perfect tracking, metric scale, secure model extraction prevention, or physical
  iOS/Android support without evidence. Package/Node tests do not establish any AR support.
- Default to on-device processing. Do not add automatic telemetry or upload camera frames.
- Keep actual device results and known limitations distinct from targets and emulated tests.

## Validation and distribution

All checks and npm publication run locally. Do not introduce GitHub Actions or CI/CD workflows
unless the user changes this decision. Use npm commands and commit `package-lock.json`.

Run `npm run check` before submitting a change. The packed-artifact check installs a real tarball;
preserve it when adding runtime code. Add meaningful behavior tests with implementation.
Use the committed lockfile and exact tooling versions. Do not commit generated `dist/`, local
tarballs or credentials. Keep the tarball allowlist narrow.

Publication is intentionally blocked by `private: true`. Do not remove it, publish to npm,
configure publishing credentials or create a release as part of ordinary development.
Follow `docs/releasing.md` when publication is explicitly requested. A GitHub push is not an
npm release or device validation.
