# Weekly-planning product documentation

Updated: 2026-08-22

## Current interpretation

`weekly-planning-spec.md` records product intent and historical planning ideas. It is useful for goals such as conversational planning, review-before-save, consideration of existing commitments and reducing unnecessary questions.

Detailed algorithm examples inside the spec are not automatically current runtime requirements. In particular, historical heuristics such as fixed six-day equal distribution, fixed daily multipliers, reserve-day rules, lexical subject heuristics or explicit mode-switch assumptions must be checked against current Stable V5 code/contract before implementation.

Current runtime authority:

- `../ai/weekly-planning-current-contract-v5.md`
- `../ai/weekly-planning-current-contract-status.md`
- `../ai/strategy/weekly-planning-roadmap.md`
- `../architecture/README.md`

## Historical implementation guide

`codex-implementation-guide.md` is retained only as a historical filename/reference. It is not a current implementation instruction or source of truth.

New implementation work should be represented by an open Issue and, when needed, one current task under `../ai/tasks/`.
