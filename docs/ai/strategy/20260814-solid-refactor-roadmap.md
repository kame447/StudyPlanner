# SOLID file-by-file refactor roadmap

Status: active
Updated: 2026-08-14
Branch: `agent/browser-regression-audited-integration`

Canonical architecture references:

- `docs/ai/weekly-planning-current-contract-v5.md`
- `docs/ai/weekly-planning-pipeline-guide.md`
- `AGENTS.md`

Execution ledger:

- Loops 0-12: see `docs/ai/tasks/20260814-solid-file-by-file-refactor-and-md-inventory.md`.
- Loop 13: `src/components/AppSettingsDialog.tsx`
  - extracted support-only FAQ/legal/contact/version content into `AppSettingsSupportPanel.tsx`.
  - retained modal shell, settings state, theme, week-start and personalization reset ownership in `AppSettingsDialog`.
  - no product/Stable V5 behavior change intended.
- Loop 14: `src/components/ActualEditorCard.tsx`
  - extracted plan/actual → `ActualDraft` construction, legacy alignment inference, and relink-candidate projection into `src/lib/actualDrafts.ts`.
  - kept editor state, save/delete interactions and rendering in the component.
  - added `src/lib/actualDrafts.test.ts` covering new/existing draft construction, explicit/legacy alignment, and relink projection.
- Loop 15: `src/components/ActualTrackingTools.tsx`
  - kept stopwatch/timer interaction state and rendering together as one cohesive measurement-tool responsibility.
  - extracted elapsed-time calculation, timer clamping/parsing/formatting and measured-range projection into `src/lib/actualTracking.ts`.
  - added `src/lib/actualTracking.test.ts` for duration formatting, paused/running elapsed calculation, timer bounds and range projection.
- Loop 16: `src/components/AdminApp.tsx`
  - no change.
  - admin auth resolution, local browser navigation, guard and route composition form one small composition-root responsibility; extracting hooks now would add indirection without reuse or a distinct policy owner.

Next priorities:

1. Continue `src/components/` file-by-file audit.
2. Prefer dead-surface removal and behavior-preserving responsibility extraction before feature work.
3. Audit duplicated actual-entry concerns across `ActualEditorCard`, `StandaloneActualEditorCard`, `ActualTrackingTools`, and Quick Entry without prematurely merging distinct workflows.
4. Treat `NaturalLanguageAssistant.tsx` / `QuickEntryModal.tsx` separation as Issue #52, not an opportunistic mega-rewrite.
5. Treat raw-text weekly entry routing as Issue #115; do not add regex heuristics during refactor.
6. Keep trace/privacy, cross-device approval, personalization and saved-preview migration concerns in their existing Issues rather than mixing them into structural loops.

Loop rule:

Every completed loop must update this roadmap and `docs/ai/tasks/20260814-solid-file-by-file-refactor-and-md-inventory.md` before the next code file is started.
