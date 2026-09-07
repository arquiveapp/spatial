# ARchive Spatial

Framework-neutral browser AR research library. **M0 foundations and M1 lab experiments are
implemented; production AR sessions, renderer adapters and device support are not.** No npm
release exists. Every package remains private and every device row remains untested.

## Current API

The unpublished `@arquiveapp/spatial` façade re-exports the dependency-free
`@arquiveapp/spatial-core` capability probe:

```ts
import { probe } from "@arquiveapp/spatial";
const capabilities = await probe();
// Inspect capabilities.webxr.immersiveAr and capabilities.camera.
// capabilities.support is always "untested"; detection is not physical validation.
```

Importing allocates no camera, renderer, listener, timer or Worker and is safe in Node/SSR.
`probe()` checks API presence, known permission policies and `isSessionSupported('immersive-ar')`.
It never requests camera/motion permission. Camera `available` means the API exists in a secure
context, not that permission is granted or a camera works. Policy and rejected XR queries remain
explicitly unknown. Worker-only capture availability cannot be determined without starting a
Worker and remains unknown. No browser name decides support.

## Local development

Use Node.js 24 (`.nvmrc`) and npm 11.19.0; tools require Node >=22.13.

```sh
npm ci
npm run check
npm run build:wasm  # Docker required; digest-pinned Emscripten 6.0.2
npm run test:wasm
npm run devlab     # http://127.0.0.1:4178
```

`check` runs formatting, rights, strict types, builds, behavioral tests, publint and installation
of all five real tarballs into an isolated consumer. Both NodeNext and Bundler declarations and
browser-free ESM imports are tested. `npm run sbom` emits the installed npm CycloneDX inventory.
WASM tests are a separate explicit local gate; npm pack does not invoke Docker or publish.

The lab provides an Android WebXR cube, camera/Worker/SIMD measurements and a throwaway gyro +
planar patch diagnostic. Read [the lab procedure](docs/validation.md) before using its results.
The current capture experiment uses the ImageBitmap/canvas path; preferred TrackProcessor paths
remain pending. Synthetic tests do not validate iOS capture, gyro axes, tracking or thermal use.

Physical phones require consumer-controlled HTTPS hosting. Loopback HTTP works only on the
same machine; the server binds to loopback and has a narrow static-file allowlist. No tunnel,
hosted service, certificate bypass or public deployment is configured.

## Packages and boundaries

| Workspace                              | Current behavior                                                   |
| -------------------------------------- | ------------------------------------------------------------------ |
| `@arquiveapp/spatial`                  | Compatibility façade for `probe()`                                 |
| `@arquiveapp/spatial-core`             | Permission-free capability detection; zero dependencies            |
| `@arquiveapp/spatial-backend-webxr`    | Reserved, exports nothing until M1 physical gates pass             |
| `@arquiveapp/spatial-backend-vio-lite` | Reserved, exports nothing; M1 prototype lives outside distribution |
| `@arquiveapp/spatial-renderer-three`   | Reserved, exports nothing; three.js not installed yet              |

Core imports no backend or renderer. Original code is MIT. Third-party tooling keeps its own
notices. Model geometry delivered to a browser is extractable; the library promises no protection.
No native viewer handoff, accounts, telemetry, licence checks or automatic camera uploads.
Orientation-only viewing is not AR. The patch prototype uses assumed scale, never metric scale.

[Decisions](docs/decisions.md) · [Dependency rights](docs/dependencies.md) ·
[Support matrix](SUPPORT_MATRIX.md) · [Limitations](KNOWN_LIMITATIONS.md) ·
[Maintenance](docs/maintenance.md) · [Release gates](docs/releasing.md).
Maintainers work on main with local checks. No CI/CD, release tag or npm publication is authorized
by ordinary implementation work. npm scope ownership remains unverified.
