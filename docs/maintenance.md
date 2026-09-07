# Library maintenance and versioning

## One long-lived branch

`main` is the integration branch and source of releases. Maintainers work directly on it with
small, coherent, locally checked commits. No `develop`, `staging` or permanent `release/*` branches.
A push is not a release: the npm registry changes only through an explicit local release operation.

Start by inspecting status and fetching origin. Fast-forward a clean checkout; do not reset,
stash or rewrite someone else's work. If main advances while working, integrate it safely and
rerun affected checks before pushing. Never force-push main or published tags. Stage only your work.

Contributors without write access may use forks/PRs. Short-lived `codex/*` branches/worktrees are
an exception for isolation when a task needs it, not a required development or release stage.
Integrate completed work into main promptly. Serialize releases: one person/agent owns each release.

Keep incomplete features unexported or explicitly unavailable. Main must remain packageable;
“main-only” does not mean exposing unfinished public behavior. Hotfixes normally land on main and
ship in a new compatible release. We do not currently promise maintenance of historical release
lines. If a future task requires a backport that main cannot provide, decide that support policy
explicitly instead of silently inventing permanent branches or mislabelling a breaking hotfix.

## Consumer compatibility

The public contract includes documented exports/types, options, behavior, errors/events, loading
paths, supported environments and lifecycle guarantees. File rearrangements inside that boundary
are internal. Removing an exported type or raising a documented browser/TypeScript requirement
can break consumers even if JavaScript function names stay the same.

Keep release notes focused on effects and migration steps. Deprecate before removal where feasible;
avoid noisy automatic warnings in consumer applications. Never describe a tracking accuracy gain
without measurement. Changes in dependency rights or permissions require explicit review.

## Versions and channels

Follow [SemVer](https://semver.org/) once a public contract exists: compatible fixes use patch,
compatible additions use minor, incompatible changes use major. Never change an already released
version's contents. `1.0.0` means a deliberately supported public API, not “all imaginable features”.

Before 1.0, use this stricter **project convention**: compatible fixes increment patch; new
features or breaking changes increment minor, with breaking changes clearly labelled and explained.
This convention is not a guarantee supplied by SemVer for all `0.x` packages. Avoid publishing
usable releases as `0.0.x`; `0.0.0` is the unpublished scaffold placeholder.

Examples, not scheduled releases:

| Meaning                           | Version         | npm channel                         |
| --------------------------------- | --------------- | ----------------------------------- |
| First usable experiment           | `0.1.0-alpha.0` | `next`                              |
| Revised experiment                | `0.1.0-alpha.1` | `next`                              |
| Chosen supported pre-1.0 baseline | `0.1.0`         | `latest`, only by explicit decision |
| Compatible fix to that baseline   | `0.1.1`         | `latest`                            |
| Incompatible pre-1.0 revision     | `0.2.0`         | `latest` after migration review     |

`next` and `latest` are mutable npm pointers, not Git branches. Always set a publish channel
explicitly. Never let a prerelease become `latest` by relying on a CLI default. Moving a channel
does not change a version number or affect existing lockfiles.

## Commits and changelog

Use concise commit subjects such as `fix: ...`, `feat: ...`, `docs: ...`, `chore: ...` and
`release: X.Y.Z`. These are a readability convention; no commit linter or automatic release bot is
required. Decide version impact from the public contract, not just the commit prefix.

Maintain [CHANGELOG.md](../CHANGELOG.md) with an Unreleased section and, when applicable, Added,
Changed, Deprecated, Removed, Fixed or Security entries. At release, move relevant entries under
the exact version and real date. Include migration notes and known limitations. Documentation or
tooling-only changes need not force an npm release.

## Dependencies and local gates

Use `npm ci` to reproduce the lockfile. Update dependencies deliberately with rights review,
upstream change notes and tests; do not blindly run `npm audit fix --force`. The lockfile reproduces
our development environment; it does not constrain consumers' transitive resolution. When runtime
or peer dependencies exist, test/document supported ranges and avoid unnecessary duplicates.

Run `npm run check` before committing, plus behavior/device tests relevant to the change.
Preserve packed-consumer tests. Report what actually ran, including tool/device versions and
remaining gaps. Keep all automation local; no hosted CI/CD is required or configured.

## Sources and interpretation

Researched 2026-09-07: [release from trunk](https://trunkbaseddevelopment.com/release-from-trunk/),
[SemVer](https://semver.org/), [npm dist-tags](https://docs.npmjs.com/cli/v11/commands/npm-dist-tag/)
and [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Direct main work, manual SemVer
selection, local gates and latest-line-only support are explicit project choices, not universal rules.
