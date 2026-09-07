# Contributing

Spatial is in the research and packaging stage. Start with [AGENTS.md](AGENTS.md), then read
[current decisions](docs/decisions.md). Propose substantial tracking or licensing changes with
their evidence and consumer implications before implementation.

Use Node.js 24 and npm 11.19.0. Install with `npm ci`, make focused changes,
run `npm run format` and `npm run check`, and describe the problem, resulting behavior and validation
in your pull request. Document third-party sources in [the dependency record](docs/dependencies.md).

Contributions to original code are made under the repository's MIT licence. Include only code
and materials you have the right to contribute, retaining third-party notices. Do not attach
private camera recordings or customer models to public issues without permission.

The current checks validate the package. Future AR changes need reproducible behavior tests and
physical-device evidence for any compatibility claim. Report device, OS, browser and limitations.
