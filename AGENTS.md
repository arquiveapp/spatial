# Spatial — repository rules and map

Standalone public browser AR library; currently a package scaffold. Read
[decisions](docs/decisions.md) for implemented versus planned work. Do not select or implement
an AR engine without the implementation task establishing that scope.

## Rules for every change

- Work on `main` by default, with small checked commits. No permanent development/release branches.
  Never force-push shared history or overwrite another contributor's uncommitted work.
- All checks and npm publication run locally. Do not introduce CI/CD or hosted-service dependencies.
- Use npm and the committed lockfile. Run `npm run check` before committing; summarize evidence.
- Original code is MIT. Review dependency rights before adding or upgrading anything; do not
  silently restrict consumers' commercial/proprietary use. See [rights](docs/dependencies.md).
- Never commit secrets, private workspace data or customer assets. No automatic camera uploads
  or telemetry. Do not promise extraction protection or untested device compatibility.
- Keep the library independent of ARchive services and frameworks. Importing it must be inert.
- npm publication, Git release tags and release creation require a release task. Ordinary commits
  and pushes do not authorize them. Keep `private: true` until the first-release gates are met.

## Read only what applies

| Work                                           | Instructions / source of truth                   |
| ---------------------------------------------- | ------------------------------------------------ |
| Runtime, public API, types                     | [src/AGENTS.md](src/AGENTS.md)                   |
| Scripts, package metadata, lockfile or tooling | [scripts/AGENTS.md](scripts/AGENTS.md)           |
| Documentation or agent instructions            | [docs/AGENTS.md](docs/AGENTS.md)                 |
| Main, compatibility and version choices        | [Maintenance](docs/maintenance.md)               |
| Authorized release                             | [Local release runbook](docs/releasing.md)       |
| Dependencies, compiled engines, assets         | [Dependency rights](docs/dependencies.md)        |
| Writing/scoping these instructions             | [Instruction design](docs/agent-instructions.md) |

Read applicable nested instructions before editing. Nested files refine their subtree; explicit
user instructions take priority over repository guidance. Resolve contradictions at their source.
`CLAUDE.md` files import adjacent `AGENTS.md` files and must not duplicate policy.
