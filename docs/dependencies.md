# Dependency rights record

No runtime dependencies, WASM engines, model weights or third-party model assets are currently
distributed. The root MIT licence covers original repository code only.

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
and effect on proprietary downstream integration. No candidate tracking engine is pre-approved.

Keep customer assets and their rights separate from the library's code licence. Do not infer
that a public source repository grants rights to third-party brands, datasets or model assets.
