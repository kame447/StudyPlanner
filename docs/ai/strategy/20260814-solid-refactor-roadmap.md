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

- Loop 13: `src/components/AppSettingsDialog.tsx` — support panel extraction.
- Loop 14: `src/components/ActualEditorCard.tsx` — actual draft/alignment projection extraction with tests.
- Loop 15: `src/components/ActualTrackingTools.tsx` — tracking calculations extraction with tests.
- Loop 16: `src/components/AdminApp.tsx` — no change; composition root remains cohesive.
- Loop 17: `src/components/AdminGuard.tsx` — no change; access-boundary rendering remains minimal.
- Loop 18: `src/components/AdminViews.tsx` — report presentation extracted to `AdminReportViews.tsx` with focused tests; routing/data loading retained in the original file.
- Loop 19: `src/components/AiRuntimeSettings.tsx` — no change; config policy/storage/proxy rules already live in `src/lib/aiConfig.ts`, leaving a small cohesive editor UI.
- Loop 20: `src/components/AuthScreen.tsx` — access-key gate lifecycle extracted to `AuthAccessGateForm.tsx` with focused interaction coverage; sign-in/sign-up UI stays in the auth surface.
- Loop 21: `src/components/BookshelfView.tsx` — active-material filtering, missing-subject fallback reconstruction and subject grouping/sorting extracted to `src/lib/bookshelfMaterials.ts` with focused tests.
- Loop 22: `src/components/DatePickerDialogs.tsx` — day calendar extracted to `DayCalendarDialog.tsx`; week picker remains the module owner and the old day-picker import path is preserved by re-export.
- Loop 23: `src/components/DayNotebookPanel.tsx` — removed as an unreferenced dead component surface.
- Loop 24: `src/components/DayTimeline.tsx` — overlap lane layout extracted to `src/lib/dayTimelineLayout.ts`; duplicate actual title/subject/alignment inference replaced by shared `actualDrafts` helpers; focused layout tests added.
- Loop 25: `src/components/DayView.tsx` — daily material shelf and material quick-create modal extracted; shared bookshelf and quick-entry contracts reused instead of duplicating filtering/end-time policy.
- Loop 26: `src/components/FloatingActualTrackingPanel.tsx` — no change; draggable/collapsible floating shell remains cohesive and delegates all measurement behavior to `ActualTrackingTools`.
- Loop 27: `src/components/InitialPrivacyConsentScreen.tsx` — no change; consent interaction stays in the screen while persistence/retry/sign-out semantics remain callback-owned; privacy copy was not changed.
- Loop 28: `src/components/InitialWeekStartPreferenceScreen.tsx` — no change; first-run week-start selection remains a small cohesive UI and delegates persistence/interpretation through typed callbacks/contracts.

Next priorities:

1. Continue `src/components/` file-by-file audit with the remaining startup/legal screens.
2. `DayView.tsx` still owns timetable-import interaction and detail-modal composition; split only if each boundary remains independently testable.
3. Continue reducing `BookshelfView.tsx` only through independent responsibilities; subject/material modal lifecycles remain extraction candidates.
4. Continue splitting `AdminViews.tsx` only when a distinct responsibility can be removed without creating page-level duplication.
5. Prefer dead-surface removal and behavior-preserving responsibility extraction before feature work.
6. Audit duplicated actual-entry concerns across `ActualEditorCard`, `StandaloneActualEditorCard`, `ActualTrackingTools`, and Quick Entry without prematurely merging distinct workflows.
7. Treat `NaturalLanguageAssistant.tsx` / `QuickEntryModal.tsx` separation as Issue #52, not an opportunistic mega-rewrite.
8. Treat raw-text weekly entry routing as Issue #115; do not add regex heuristics during refactor.
9. Keep trace/privacy, cross-device approval, personalization and saved-preview migration concerns in their existing Issues rather than mixing them into structural loops.

Per-loop documentation rule:

Before starting the next code file, update this roadmap and `docs/ai/tasks/20260814-solid-file-by-file-loop-log.md`. The large parent inventory is updated at checkpoints or when the MD inventory / remaining-problem classification changes.
