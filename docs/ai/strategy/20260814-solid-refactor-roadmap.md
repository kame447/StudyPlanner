# SOLID file-by-file refactor roadmap

Status: seven-perspective audit / final verification
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
- Seven-perspective audit: `docs/ai/audits/20260814-solid-refactor-seven-audit.md`

Current checkpoint:

- Loops 13-37: file-by-file extraction / no-change / deferred decisions recorded in the compact loop log.
- Loop 38: fixed the adversarially discovered `DailyMaterialShelf` fallback-metadata ordering regression and added direct coverage.
- Loop 39: added direct component regression for the extracted `MaterialQuickCreateModal` contract.
- Loop 40: removed ReportView dead prop/caller plumbing discovered by the ISP audit.
- Loop 41: updated the isolated Browser Regression runner from Playwright 1.55.0 to official stable 1.62.1 after the old isolated install reported two high-severity audit findings; application manifests remain isolated.
- Loop 42: removed three root-level completed task duplicates after verifying their closed records.
- Earlier exact head `f8eea8348ecbc456046efd3915aa12af3b720e38` passed normal CI and Browser Regression 80/80. Final verification must run again on the post-Loop-42 head before PR #129 is considered ready.

Seven-perspective audit

1. Architecture / responsibility boundaries
   - Result after fixes: PASS.
   - Extracted modules have independent change reasons; no Stable V5 semantic ownership boundary changed.
2. Behavior preservation / type contracts
   - Result after fixes: PASS pending final-head CI.
   - One actual fallback-order regression was found and fixed; ReportView dead props were removed without changing rendering/calculation behavior.
3. State / data invariants
   - Result after fixes: PASS.
   - identity, occurrence, alignment, material provenance, raw-vs-trimmed candidate semantics, recurrence and persisted-data schemas were not changed.
4. UX / browser / accessibility
   - Result after fixes: PASS pending final Browser Regression.
   - Prior post-hardening head passed 80/80 browser contracts; final runner upgrade requires the same suite to pass again.
5. Test quality / harness correctness
   - Result after fixes: PASS pending final Browser Regression.
   - Added component regressions for the two day-material extraction boundaries; upgraded the isolated Playwright harness rather than modifying production for a harness dependency warning.
6. Observability / security / dependency trust
   - Result after fixes: PASS WITH NONBLOCKING BUILD DEBT.
   - Application `npm ci` reported zero vulnerabilities on the verified head. Existing Vite chunk/code-splitting warnings are not caused by this refactor and are recorded as separate performance debt, not a correctness blocker.
7. Documentation / Git / merge hygiene
   - Result after fixes: PASS pending final-head checks.
   - One refactor PR only (#129); loop log/roadmap/index synchronized; closed-task root duplicates reduced. Branch name is historically reused from merged #127 but changing it now would add unnecessary Git churn.

Fix-loop policy

- Findings that are unambiguously implementation defects or behavior-preservation defects may be fixed immediately in PR #129, with focused regression where useful, then re-audited.
- Stale/incorrect test contracts may be corrected only after checking the current canonical contract.
- Harness problems are fixed in the harness, not production code.
- Product/spec changes, legacy compatibility decisions, or changes to older specification Markdown still require user confirmation.
- Issue #52 and #115 remain separate functional/architecture work units; do not opportunistically implement them as part of structural cleanup.

Known structural debt retained for the next file-by-file phase after this audit checkpoint is green:

- `DayView.tsx`: timetable-import interaction and detail-modal composition remain.
- `BookshelfView.tsx`: subject/material modal lifecycles remain.
- `AdminViews.tsx`: user-list/detail loading and route composition remain after report presentation extraction.
- `MonthEventDialog.tsx`: save normalization and recurrence delete-scope policy remain mixed with editor UI.
- `MonthView.tsx`: pager gesture/keyboard state remains mixed with month projection/rendering.
- `NaturalLanguageAssistant.tsx` / `QuickEntryModal.tsx`: dedicated weekly-planning UI separation remains Issue #52.
- raw-text weekly entry routing remains Issue #115 and must not be repaired by adding regex heuristics.

Per-loop documentation rule:

Before starting the next code file or audit-fix loop, update this roadmap and `docs/ai/tasks/20260814-solid-file-by-file-loop-log.md`. The large parent inventory is updated at checkpoints or when the MD inventory / remaining-problem classification changes.
