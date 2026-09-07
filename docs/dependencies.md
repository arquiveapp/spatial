# Dependency rights record

No runtime dependencies, WASM engines, model weights or third-party model assets are currently
distributed. The root MIT licence covers original repository code only.

## Rules before adding or upgrading a component

- Inspect the exact version and actual licence files, including transitive dependencies and
  native code compiled into WASM. Copied examples, model weights and datasets count too.
- Preserve required notices, attribution and corresponding source/build materials.
- Permissive commercial/proprietary downstream use is the intended contract. Do not ship
  copyleft, noncommercial, source-available or proprietary components without an explicit
  distribution decision explaining their effect on that contract.
- A wrapper, Worker, dynamic import, iframe or separate package is not assumed to remove
  obligations. Do not relabel third-party code with our MIT licence. Surface a material rights
  conflict with alternatives before committing the architecture to that dependency.
- Record shipped versus development-only code, source/version, licence, consumer obligations
  and unresolved questions here. Metadata alone does not complete the rights review.

## Direct development tools

| Tool       | Version | Reported licence | Shipped in the library tarball? | Source                                  |
| ---------- | ------- | ---------------- | ------------------------------- | --------------------------------------- |
| TypeScript | 7.0.2   | Apache-2.0       | No                              | https://github.com/microsoft/TypeScript |
| Prettier   | 3.9.6   | MIT              | No                              | https://github.com/prettier/prettier    |
| publint    | 0.3.24  | MIT              | No                              | https://github.com/publint/publint      |
| npm CLI    | 11.19.0 | Artistic-2.0     | No; developer package manager   | https://github.com/npm/cli              |

Direct tool licence identifiers were checked against npm registry metadata during scaffold setup.
The lockfile records resolved dependencies. This table is not a completed legal audit of every
transitive development dependency. Run `npm sbom --sbom-format cyclonedx` to inspect installed dependency metadata, then inspect
actual licence files when reviewing changes; metadata alone is not proof.

Before shipping any third-party runtime, record its exact source/version, full transitive and
compiled dependency chain, licence files, notices, modifications, source delivery requirements,
and effect on proprietary downstream integration. No external candidate tracking engine is pre-approved.

## M0 local rights gate

See [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) for exact development-tool evidence,
optional platform limits, the pinned Emscripten diagnostic and proposed future dependencies.
`npm run check:rights` enforces the reviewed lockfile and licence/notice hashes locally;
`npm run sbom` emits CycloneDX. There is no hosted SBOM workflow.
The foundation added only original internal packages. The authorized phone lab now uses exact
three.js 0.185.1 (MIT, no dependencies), after reviewing its actual LICENSE; it is development-only
and excluded from all library tarballs. The optional existing cloudflared CLI is lab transport
only. Models remain private local fixtures with independent rights.

Keep customer assets and their rights separate from the library's code licence. Do not infer
that a public source repository grants rights to third-party brands, datasets or model assets.
