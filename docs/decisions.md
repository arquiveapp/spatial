# Current decisions

## Established for the scaffold

- One package, not a premature monorepo. Split packages only when real implementation needs it.
- Intended npm name: `@arquiveapp/spatial`; scope ownership remains unverified.
- Original code: MIT. No runtime dependencies or AR APIs yet.
- TypeScript compiled to ESM and declaration files. Browser support is not implied by the
  compilation target. CommonJS and CDN-specific bundles are not promised.
- npm lockfile, strict types, formatting, publint and real packed-consumer checks.
- Public GitHub source; npm publication disabled. All checks and publication are local.
  No CI/CD workflows, hosted services or release credentials.

## Pending research and implementation brief

- Tracking engines and exact dependency rights, including WASM and transitive components.
- Renderer and adapter contracts; model loading and authenticated asset integration.
- Capability matrix, sensor strategy, scale, anchoring and recovery.
- Performance budgets and physical iOS/Android acceptance criteria.
- Distribution of workers/WASM assets, CSP/CORS and optional isolation requirements.
- First usable API and release version; npm organization access and publishing setup.

There are no device-support claims, tracking benchmarks or runtime features to validate yet.
