# Contributing

Spatial has M0 foundations and M1 lab experiments. Start with [AGENTS.md](AGENTS.md), then read
[current decisions](docs/decisions.md). Propose substantial tracking or licensing changes with
their evidence and consumer implications before implementation.

Use Node.js 24 and npm 11.19.0. Install with `npm ci`, make focused changes,
run `npm run format` and `npm run check`, and describe the problem, resulting behavior and validation
with your change. Maintainers normally commit directly to `main`; external contributors may use
forks and pull requests. Follow [maintenance](docs/maintenance.md) for compatibility, versioning
and changelog rules. No release branches or CI/CD workflows are required.
Document third-party sources in [the dependency record](docs/dependencies.md).

Contributions to original code are made under the repository's MIT licence. Include only code
and materials you have the right to contribute, retaining third-party notices. Do not attach
private camera recordings or customer models to public issues without permission.

The current checks validate packaging, capability behavior and synthetic diagnostics. AR changes need
physical-device evidence for any compatibility claim. Report device, OS, browser and limitations.
