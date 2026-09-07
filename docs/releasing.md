# Local releases from main

Current status: no npm release. All workspace packages remain unpublished with `private: true`; only capability detection is public.
The intended name is `@arquiveapp/spatial`; npm scope access is not yet verified.
This runbook is for an explicitly requested release, not instructions to publish during maintenance.
Read [maintenance](maintenance.md) for version/channel decisions and main-only policy.

## Before enabling the first release

- Pass G1/G2 and the M2 device cleanup/denied-permission gates in [validation](validation.md).
- Implement useful behavior and document the public contract and actual support limits.
- Select the workspace packages to release, update their internal version references and verify
  every exact tarball. The root façade depends on core; do not publish it before core is available.
- Finish the shipped-dependency rights review, including required notices/source delivery.
- Verify npm scope permissions independently of GitHub access. Local `npm login`/2FA handles
  authentication; never store tokens or recovery codes in the repository.
- Choose a version and channel deliberately. Remove `private: true` only in the authorized first
  release change, not as general setup. No release credentials, CI/CD or automatic hooks are needed.

## Prepare one candidate

1. Use a clean main checkout, fetch origin and fast-forward. Resolve concurrent work before
   proceeding; never force or stash another person's changes. One maintainer owns this release.
2. Choose `X.Y.Z` (possibly a prerelease suffix) using the compatibility policy. Check both the
   registry and Git tags for collisions. A network/authentication error is not evidence of absence.
3. Use `npm version <chosen-version> --no-git-tag-version` to update package metadata and lockfile
   together. Update CHANGELOG with the real date, consumer changes, migrations and limitations.
4. Run `npm ci` and `npm run check`; add applicable browser/device evidence. Review the diff,
   commit the candidate as `release: <chosen-version>`, and record its full commit SHA.
5. From that clean commit, run `npm pack --json`. Confirm no source changed after the passing
   checks; otherwise rerun them. Record the generated tarball's filename and npm-reported integrity.
   Keep that artifact; do not publish from a later build or moving working directory.
6. Inspect the exact tarball contents and install that exact path in a disposable consumer. Verify
   ESM import, declarations and the relevant runtime behavior. Review package sizes and licences.
   The current `npm run test:package` generates its own tarball; it does not accept an existing
   tarball path and therefore does not replace this final exact-artifact check.
7. Run `npm publish ./<exact-tarball>.tgz --dry-run --tag <channel> --access public` and inspect
   the result. A dry run does not prove registry permissions or successful publication.

Angle-bracket values above and below are placeholders, not literal runnable commands. Do not
change source/version between candidate verification and publication. If anything changes, prepare
and verify a new candidate. Keep the commit, tarball and verification record associated.

## Tag, publish and verify

1. Fetch origin again. Confirm the candidate remains the intended main release, with a clean
   checkout. If remote main moved, resolve the release ownership/conflict before tagging.
2. Create an annotated `v<chosen-version>` tag at the verified commit, then push only main and
   that exact tag together: `git push --atomic origin main refs/tags/v<chosen-version>`.
   Never force a tag, push every local tag, or silently retry a rejected main update.
3. Publish the inspected tarball locally:
   `npm publish ./<exact-tarball>.tgz --tag <channel> --access public`.
   Use `next` for experiments; `latest` only for an explicitly intended default release.
4. Verify `npm view @arquiveapp/spatial@<chosen-version> version dist.integrity --json` and
   `npm dist-tag ls @arquiveapp/spatial`. Compare integrity with the local artifact record.
5. Install the exact registry version in a fresh consumer and run import/types/runtime checks.
   Record source SHA/tag, artifact integrity, version, channel and evidence in the release notes.
6. Create the corresponding GitHub Release from the existing tag, using the reviewed changelog
   section and evidence. Mark experimental versions as prereleases. Attach the inspected tarball
   when appropriate; do not upload customer models or private recordings.

A GitHub tag/Release and an npm publication are separate operations. No step triggers a workflow.
Local publication must not claim CI-generated npm provenance. Revisit official authentication
requirements at release time; they may change independently of the library.

## Failures and corrections

- Git succeeds but npm fails: report a tagged, unpublished candidate. Inspect registry state before
  retrying because a timeout may have happened after acceptance. Retry only the same verified
  artifact/version if absent; never overwrite an existing version.
- npm succeeds but later verification or GitHub release creation fails: the npm version exists.
  Complete the missing step or report the defect; do not republish or rewrite its tag.
- Bad package: fix on main and issue a new version. Consider a clear `npm deprecate` notice for
  the affected exact version and moving the channel to a verified earlier release. Do not unpublish
  as routine rollback; existing installations/lockfiles are not repaired by changing a dist-tag.
- A version such as `0.1.0-rc.1` cannot be renamed into `0.1.0` by moving a channel. Publish a new
  verified final-version artifact. Changing only `next`/`latest` never changes version contents.

## Official references

Checked 2026-09-07: [npm version](https://docs.npmjs.com/cli/v11/commands/npm-version/),
[npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/),
[dist-tags](https://docs.npmjs.com/cli/v11/commands/npm-dist-tag/) and
[deprecation](https://docs.npmjs.com/cli/v11/commands/npm-deprecate/).
The exact-artifact and annotated-tag sequence is our local release convention.
