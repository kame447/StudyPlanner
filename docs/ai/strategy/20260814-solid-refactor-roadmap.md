# SOLID file-by-file refactor roadmap

Status: active
Updated: 2026-08-14
Branch: `agent/browser-regression-audited-integration`

Canonical architecture references:

- `docs/ai/weekly-planning-current-contract-v5.md`
- `docs/ai/weekly-planning-pipeline-guide.md`
- `AGENTS.md`

Execution records:

- Loops 0-15 and MD inventory: `docs/ai/tasks/20260814-solid-file-by-file-refactor-and-md-inventory.md`
- Compact per-loop log from Loop 13 onward: `docs/ai/tasks/20260814-solid-file-by-file-loop-log.md`

Current completed loops:

- Loops 13-29: see compact loop log for completed extraction/no-change decisions.
- Loop 30: `src/components/MonthEventDialog.tsx` — structural debt confirmed but deferred until focused/full tests can execute; save normalization and recurrence delete-scope policy should leave the editor UI in a CI-capable checkpoint.
- Loop 31: `src/components/MonthView.tsx` — pager gesture/keyboard state, daily aggregation and cell rendering are distinct responsibilities; defer the pager split until browser regressions can run.
- Loop 32: `src/components/MonthPickerDialog.tsx` — no change; wheel-picker DOM measurement/scroll-settle/selection state is cohesive and owns no business policy.
- Loop 33: `src/components/MyPageDialog.tsx` — no change; profile/avatar/account actions remain a cohesive account modal and delegate policy to existing helpers/hooks/callbacks.
- Loop 34: `src/components/PlanFieldsEditor.tsx` — no change; typed draft field editing stays presentational.
- Loop 35: `src/components/PlanEditorPanel.tsx` — no change; editor modal orchestration owns no recurrence mutation policy.
- Loop 36: `src/components/TimeRangeFields.tsx` — no change; wheel interaction stays cohesive while time-domain calculations remain in `lib/date`.

Current structural priorities:

1. Continue `src/components/` file-by-file audit; next focus on standalone actual-entry duplication and remaining reusable plan/actual boundaries.
2. `DayView.tsx` still owns timetable-import interaction and detail-modal composition; split only if each boundary remains independently testable.
3. `BookshelfView.tsx` still owns subject/material modal lifecycles after collection logic was extracted.
4. `AdminViews.tsx` still owns user-list/detail loading and route composition after report presentation was extracted.
5. `MonthEventDialog.tsx` should move save normalization and recurrence-delete mutation planning into pure helpers once focused tests can execute.
6. `MonthView.tsx` should separate month-pager interaction from month-panel data projection/rendering with browser regression coverage.
7. Prefer dead-surface removal and behavior-preserving responsibility extraction before feature work.
8. Treat `NaturalLanguageAssistant.tsx` / `QuickEntryModal.tsx` separation as Issue #52, not an opportunistic mega-rewrite.
9. Treat raw-text weekly entry routing as Issue #115; do not add regex heuristics during refactor.
10. Keep trace/privacy, cross-device approval, personalization and saved-preview migration concerns in their existing Issues rather than mixing them into structural loops.

Per-loop documentation rule:

Before starting the next code file, update this roadmap and `docs/ai/tasks/20260814-solid-file-by-file-loop-log.md`. The large parent inventory is updated at checkpoints or when the MD inventory / remaining-problem classification changes.
