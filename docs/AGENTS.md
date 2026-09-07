# Documentation and instruction maintenance

Applies to `docs/` and, via the root map, root documentation and agent-instruction changes.

- Write repository documentation in English. Keep the README for consumers/contributors and
  AGENTS files for actionable instructions; do not copy the same policy into both.
- Follow [instruction design](agent-instructions.md) when changing AGENTS or CLAUDE files.
- Put only repository-wide invariants and routing links in root AGENTS. Scope code/tooling rules
  to existing directories; add no empty directories just to accommodate instruction files.
- Distinguish current behavior, accepted decisions, proposals and unknowns. Do not claim planned
  APIs, package publication, clean legal rights or device tests already exist.
- Cite primary sources and date research. Separate external rules from our chosen conventions.
- Update compatibility/migration notes and the Unreleased changelog for consumer-visible changes.
  Keep release history human-readable; do not paste the Git log.
- Verify paths, commands, imports and contradictory instructions. Historical notes are evidence,
  not new permission to implement, publish, access private data or change architectural policy.
- Keep detailed procedures in their canonical guide and link to it. Do not grow files with session
  transcripts, speculative rules, duplicate checklists or generic advice already enforced by tools.
