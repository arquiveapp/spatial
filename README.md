# ARchive Spatial

An open-source browser AR library in early research and development.

**This repository currently contains package infrastructure only. There is no AR implementation,
public runtime API, published npm release, or verified device support yet.**

The intended package name is `@arquiveapp/spatial`. Ownership of the npm scope must still be
verified; the GitHub organization does not grant npm publishing rights. `private: true` blocks
accidental publication during this stage. This does not make the GitHub repository private.

## Direction

- A reusable library, independent of any company's backend, framework or model catalogue.
- Processing on the visitor's device, with no mandatory vendor-operated service.
- Consumers supply model assets through their own applications and hosting.
- Target custom in-browser experiences on iOS and Android; exact support remains to be researched
  and validated on physical devices.
- Permissive downstream use is a design requirement, not an assumption about future dependencies.

No tracking engine, renderer, sensor implementation or model format contract has been selected.

## Development

Use Node.js 24 (see `.nvmrc`) and npm 11.19.0. Tooling requires Node.js 22.13 or newer.

```sh
npm ci
npm run check
```

Use the documented npm version for reproducible lockfile changes. No application server or
service credentials are needed for package development.

| Command             | Purpose                                                                         |
| ------------------- | ------------------------------------------------------------------------------- |
| `npm run build`     | Clean generated output and compile ESM JavaScript plus TypeScript declarations. |
| `npm run typecheck` | Check strict TypeScript types without emitting files.                           |
| `npm run format`    | Format source and documentation.                                                |
| `npm run check`     | Formatting, types, build, package lint and real tarball consumer checks.        |
| `npm run test`      | Build and test installation/import of the packaged artifact.                    |
| `npm pack`          | Produce a local npm-compatible `.tgz`; does not publish.                        |

All checks run locally. There is no GitHub Actions or other CI/CD workflow. These are tooling
checks, not browser or AR compatibility tests.

## Layout

```text
src/index.ts                  Reserved package entry point; currently exports no API
scripts/                      Build cleanup and packaged-consumer checks
docs/                         Decisions, dependency rights and release requirements
```

The initial packaging format is ESM with declarations. CommonJS is not advertised. Build output
is generated in `dist/`; only that output, the README, licence and package metadata enter the
tarball. A consumer installation is tested independently of this checkout, including ESM import
without browser globals and TypeScript resolution in NodeNext and Bundler modes.

## Contributing and licensing

Read [AGENTS.md](AGENTS.md) and [CONTRIBUTING.md](CONTRIBUTING.md) before implementation.
Original repository code is [MIT licensed](LICENSE). No third-party runtime is shipped yet.
Third-party components retain their own licences; MIT here never overrides their conditions.

See [dependency rights](docs/dependencies.md), [current decisions](docs/decisions.md) and
[release preparation](docs/releasing.md).
