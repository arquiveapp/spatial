# Tooling and package work

Applies to `scripts/`. The root map also requires this guide for package/lockfile/tooling changes.

- Use local npm commands. No Actions, release bots, automatic publishing hooks or credential files.
- Keep `package.json` and `package-lock.json` consistent; use npm to update the lockfile.
- Exact direct development-tool versions are intentional. For future runtime/peer ranges, prove
  the supported range rather than copying a caret or pin policy mechanically.
- Treat `exports`, `types`, `files`, module format and `sideEffects` as consumer-facing contracts.
- Preserve installation of an actual packed artifact in an isolated consumer, ESM import without
  browser globals, declaration resolution and the tarball contents allowlist.
- Packaging checks and `npm pack` must not publish, create tags or start services.
- Limit cleanup to generated output and temporary directories owned by that invocation. Use
  structured process arguments, timeouts and cleanup on failure; never shell-interpolate user data.
- Review lifecycle scripts and transitive tooling changes. Do not disable checks to pass an upgrade.
- Validate with `npm ci` for lockfile changes and `npm run check` for the final change. Record the
  actual Node/npm versions; runtime device support is unrelated to build-tool support.
- Releases use the exact inspected tarball. Read `../docs/releasing.md` before release work.
