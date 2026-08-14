# SOLID file-by-file refactor roadmap

Status: active
Updated: 2026-08-14
Branch: `agent/browser-regression-audited-integration`
PR: #129

Canonical architecture references:

- `docs/ai/weekly-planning-current-contract-v5.md`
- `docs/ai/weekly-planning-pipeline-guide.md`
- `AGENTS.md`

Execution records:

- Loops 0-15 and MD inventory: `docs/ai/tasks/20260814-solid-file-by-file-refactor-and-md-inventory.md`
- Compact per-loop log from Loop 13 onward: `docs/ai/tasks/20260814-solid-file-by-file-loop-log.md`

Current checkpoint:

- Loops 13-37: file-by-file extraction / no-change / deferred decisions recorded in the compact loop log.
- Loop 38: adversarial hardening of the Loop 25 day-material extraction. Fixed fallback subject metadata ordering regression and added a focused component regression.
- Loop 39: added direct component regression for `MaterialQuickCreateModal` after the test-quality audit found that the extraction was covered only indirectly. No production behavior change made in this loop.
- PR #129 exists specifically to run normal CI and Browser Regression for this refactor branch. No merge-ready claim is allowed until current-head runs are green.

Current execution phase: seven-perspective audit

1. Behavior preservation: compare changed code against `main` and look for silent semantic changes, ordering changes, fallback changes, default changes, lifecycle changes, and error-handling changes.
2. Type/build contract: detect broken imports, stale props, invalid type narrowing, circular dependency risk, and build-only failures.
3. Test quality: distinguish implementation defects, stale test contracts, and harness defects; check whether high-risk extractions have regression coverage rather than only helper self-tests.
4. SOLID / dependency direction: detect over-splitting, god components, duplicated domain logic, leaking implementation detail, concrete-provider dependency, and unstable facades.
5. State/data invariants: inspect identity, ownership, persisted-data compatibility, ordering, recurrence, alignment, idempotency, and mutation boundaries.
6. UX/browser/accessibility: inspect interaction semantics, modal/focus behavior, mobile/browser coverage, labels/roles, and regressions introduced by extraction.
7. Documentation/Git hygiene: keep loop log/roadmap/current contract aligned; do not claim tests passed unless executed; keep all refactor hardening in PR #129 only.

Fix-loop policy:

- Findings that are unambiguously implementation defects or behavior-preservation defects may be fixed immediately in PR #129, with focused regression where useful, then re-audited.
- Stale/incorrect test contracts may be corrected only after checking the current canonical contract.
- Harness problems are fixed in the harness, not production code.
- Product/spec changes, legacy compatibility decisions, or changes to older specification Markdown still require user confirmation.
- Issue #52 and #115 remain separate functional/architecture work units; do not opportunistically implement them as part of structural cleanup.

Known structural debt retained for later, after the current hardening checkpoint is green:

- `DayView.tsx`: timetable-import interaction and detail-modal composition remain.
- `BookshelfView.tsx`: subject/material modal lifecycles remain.
- `AdminViews.tsx`: user-list/detail loading and route composition remain after report presentation extraction.
- `MonthEventDialog.tsx`: save normalization and recurrence delete-scope policy remain mixed with editor UI.
- `MonthView.tsx`: pager gesture/keyboard state remains mixed with month projection/rendering.

Per-loop documentation rule:

Before starting the next code file or audit-fix loop, update this roadmap and `docs/ai/tasks/20260814-solid-file-by-file-loop-log.md`. The large parent inventory is updated at checkpoints or when the MD inventory / remaining-problem classification changes.
