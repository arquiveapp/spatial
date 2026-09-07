# How this repository writes agent instructions

## Structure and scope

The root `AGENTS.md` is an index plus critical rules valid everywhere. Aim for about 50 lines;
this is a repository convention, not a tool limit. Move local rules to the relevant subtree and
multi-step procedures to a linked guide. Do not create an instruction file for every folder.

Current ownership:

| File                 | Owns                                                                       |
| -------------------- | -------------------------------------------------------------------------- |
| `/AGENTS.md`         | Identity, main-only/local workflow, safety/rights invariants, task routing |
| `/src/AGENTS.md`     | Runtime, public API, resource lifecycle and behavior evidence              |
| `/scripts/AGENTS.md` | Tooling, packaging and artifact verification                               |
| `/docs/AGENTS.md`    | Documentation, research and instruction quality                            |

Instructions in a subtree apply to that subtree. Root routing explicitly asks readers to consult
selected guides for files outside their physical subtree, such as `package.json`. More specific
instructions refine inherited ones. They must not silently contradict global rights or safety
constraints. User instructions override repository conventions; higher-priority tool/system rules
still apply. Read only the guides needed by the task.

## Claude interoperability

Each existing instruction directory also has a small `CLAUDE.md` containing `@AGENTS.md`.
That is Claude Code's import syntax, relative to the importing file. It keeps one canonical text
and works without filesystem symlink support on Windows. No independent rules belong in those
bridge files. Add or remove the bridge together with its adjacent AGENTS file.

Claude loads nested instructions as relevant files are accessed. Other agents have their own
loading behavior; the root map explicitly tells them where to look. A Markdown link is navigation,
not a promise that every tool automatically imports its target. Do not import every nested guide
at root: that would load unrelated instructions on every task.

## Writing rules

- Start with scope, then concrete commands or constraints that affect decisions.
- Prefer one actionable rule per bullet; explain a non-obvious reason briefly.
- State the correct behavior and the applicable condition. Avoid vague slogans and blanket rules.
- Link to source-of-truth files instead of duplicating versions, commands and long procedures.
- Preserve useful exceptions, e.g. `src/index.ts` is the public package entry point.
- Encode verifiable invariants in checks where justified; text alone is not enforcement.
- Keep chronology in changelogs/research notes, not standing instructions.
- Change instructions when the actual workflow changes; remove obsolete/conflicting rules.
- Do not add recurrent permission questions for routine work the user already authorized.

## Review before committing

Resolve all local links and `@` imports. Read root plus the affected subtree together and look for
contradictions. Ensure the README and contribution guide route to the same policies. Run formatting
and the repository checks. Only claim a specific agent loaded instructions if that was observed;
file/import verification does not prove behavior in a Claude session.

## Research basis

Checked 2026-09-07. [AGENTS.md](https://agents.md/) documents nested instruction files and
scope. [Claude Code memory documentation](https://code.claude.com/docs/en/memory) documents
imports, scoped loading and concise instructions. The small root index, current folder split and
use of imports rather than symlinks are our repository choices based on those mechanisms.
