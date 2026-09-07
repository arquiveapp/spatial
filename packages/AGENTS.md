# Package implementation

Read [runtime rules](../src/AGENTS.md) before editing package source and
[tooling rules](../scripts/AGENTS.md) before editing manifests. Core has zero runtime
dependencies; backends depend only on core; renderer dependencies remain optional peers.
Do not expose M2 runtime APIs before the physical M1 gates in docs/validation.md pass.
