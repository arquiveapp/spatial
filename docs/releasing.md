# Release preparation

Nothing has been published to npm. `private: true` deliberately blocks publication. The intended
name is `@arquiveapp/spatial`; npm scope ownership is separate from the GitHub organization.

## Local package review

```sh
npm ci
npm run check
npm pack
```

This produces a local `.tgz`, not a registry release. The automated check also installs a tarball
in an isolated temporary consumer, verifies exports and declarations, and cleans up afterward.
The scaffold has an empty entry point: installing it provides no AR functionality yet.

## Before the first public npm release

1. Implement and document useful API behavior; do not publish the empty scaffold as a usable SDK.
2. Complete the shipped-dependency rights review and include required notices/source materials.
3. Record actual browser/device support and concrete limitations. Local Node checks are not physical QA.
4. Confirm permission to publish under the chosen npm scope; verify package-name availability.
5. Choose a meaningful prerelease version and document its stability expectations.
6. Explicitly authorize release, then remove `private: true` in a reviewed release change.
7. Run the complete checks and inspect `npm publish --dry-run` output and packed contents.
8. Authenticate locally with `npm login` when needed; complete npm two-factor authentication.
   Never add registry tokens to the repository or promise CI-generated provenance for a local release.
9. Publish the reviewed artifact with an explicit prerelease tag, then verify registry metadata
   and installation from the registry in a clean consumer.

There is no CI/CD workflow. Run checks and publish locally with npm; pushes and tags never publish.
After the release gates above, use `npm publish --tag next --access public` for an experimental
release. Use `latest` only when the release is explicitly intended for the default install channel.

References: https://docs.npmjs.com/cli/v11/configuring-npm/package-json/ and
https://docs.npmjs.com/cli/v11/commands/npm-publish/ (verify requirements when releasing).
