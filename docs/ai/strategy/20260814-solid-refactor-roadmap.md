# SOLID file-by-file refactor roadmap

Status: file-by-file phase complete / final verification green
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
- Post-Loop-42 head `1d1800213b22d90fdca42dbdd48c4744449fd20e` passed normal CI and Browser Regression 80/80. The audit checkpoint is green and the next file-by-file phase can proceed on the same PR.
- Loop 43 separated `MonthEventDialog` save normalization, validation, and recurrence delete-scope mutation policy into `src/lib/monthEventEditor.ts`, with focused policy regressions.
- Loop 44 extracted `BookshelfSubjectDialog` and `BookshelfMaterialDialog`, with shared editor-field presentation helpers and direct submit/delete contract coverage.
- Loop 45 reduced `AdminViews` to a typed route facade, moved user-list/detail pages into focused components, and centralized stale-request-safe loading in `useAdminDataLoader`.
- Loop 46 extracted `DayTimetableImportDialog` and `DayDetailModal`; DayView now composes those workflows through typed props while retaining day selection/projection ownership.
- Loop 47 extracted pure month projection, `MonthGridPanel`, and `useMonthPager`; MonthView now owns only cross-interaction composition, cell selection, and dialog coordination.
- Loops 43-47 focused typechecks and 20 targeted regressions are green.
- Local full verification is green: 329 test files passed, 1 skipped; 1521 tests passed, 14 skipped, 5 todo; production build passed with only the pre-existing chunk/code-splitting warnings.
- Implementation head `454467cd427fa61e936c62aff4b1aa7b4fb34973` passed normal CI run 2832 and Browser Regression run 124 with 80/80 browser contracts. The PR #129 implementation checkpoint is green.
- Repository execution guidance now treats this roadmap and the current task records as the source of active scope, priority, checkpoint, and next steps; `AGENTS.md` remains the stable product, architecture, safety, and repository-hygiene policy.

Seven-perspective audit

1. Architecture / responsibility boundaries
   - Result after fixes: PASS.
   - Extracted modules have independent change reasons; no Stable V5 semantic ownership boundary changed.
2. Behavior preservation / type contracts
   - Result after fixes: PASS.
   - One actual fallback-order regression was found and fixed; ReportView dead props were removed without changing rendering/calculation behavior.
3. State / data invariants
   - Result after fixes: PASS.
   - identity, occurrence, alignment, material provenance, raw-vs-trimmed candidate semantics, recurrence and persisted-data schemas were not changed.
4. UX / browser / accessibility
   - Result after fixes: PASS.
   - Final implementation head passed the same 80/80 browser contracts after the runner upgrade and Loops 43-47.
5. Test quality / harness correctness
   - Result after fixes: PASS.
   - Added component regressions for the two day-material extraction boundaries; upgraded the isolated Playwright harness rather than modifying production for a harness dependency warning.
6. Observability / security / dependency trust
   - Result after fixes: PASS WITH NONBLOCKING BUILD DEBT.
   - Application `npm ci` reported zero vulnerabilities on the verified head. Existing Vite chunk/code-splitting warnings are not caused by this refactor and are recorded as separate performance debt, not a correctness blocker.
7. Documentation / Git / merge hygiene
   - Result after fixes: PASS.
   - One refactor PR only (#129); loop log/roadmap/index synchronized; closed-task root duplicates reduced. Branch name is historically reused from merged #127 but changing it now would add unnecessary Git churn.

Fix-loop policy

- Findings that are unambiguously implementation defects or behavior-preservation defects may be fixed immediately in PR #129, with focused regression where useful, then re-audited.
- Stale/incorrect test contracts may be corrected only after checking the current canonical contract.
- Harness problems are fixed in the harness, not production code.
- Product/spec changes, legacy compatibility decisions, or changes to older specification Markdown still require user confirmation.
- Issue #52 and #115 remain separate functional/architecture work units; do not opportunistically implement them as part of structural cleanup.

Structural debt addressed in Loops 43-47:

- `DayView.tsx`: timetable-import interaction and detail-modal composition extracted.
- `BookshelfView.tsx`: subject/material modal lifecycles extracted.
- `AdminViews.tsx`: user-list/detail loading and route composition extracted.
- `MonthEventDialog.tsx`: save normalization and recurrence delete-scope policy extracted.
- `MonthView.tsx`: pager gesture state and month projection/rendering extracted; keyboard/cell selection remains in the composition root because it coordinates the active grid and external selected-date contract.

Structural debt intentionally retained outside this phase:
- `NaturalLanguageAssistant.tsx` / `QuickEntryModal.tsx`: dedicated weekly-planning UI separation remains Issue #52.
- raw-text weekly entry routing remains Issue #115 and must not be repaired by adding regex heuristics.

Per-loop documentation rule:

Before starting the next code file or audit-fix loop, update this roadmap and `docs/ai/tasks/20260814-solid-file-by-file-loop-log.md`. The large parent inventory is updated at checkpoints or when the MD inventory / remaining-problem classification changes.
