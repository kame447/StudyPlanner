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

Next priorities:

1. Continue `src/components/` file-by-file audit.
2. Prefer dead-surface removal and behavior-preserving responsibility extraction before feature work.
3. Audit duplicated actual-entry concerns across `ActualEditorCard`, `StandaloneActualEditorCard`, `ActualTrackingTools`, and Quick Entry without prematurely merging distinct workflows.
4. Treat `NaturalLanguageAssistant.tsx` / `QuickEntryModal.tsx` separation as Issue #52, not an opportunistic mega-rewrite.
5. Treat raw-text weekly entry routing as Issue #115; do not add regex heuristics during refactor.
6. Keep trace/privacy, cross-device approval, personalization and saved-preview migration concerns in their existing Issues rather than mixing them into structural loops.

Per-loop documentation rule:

Before starting the next code file, update this roadmap and `docs/ai/tasks/20260814-solid-file-by-file-loop-log.md`. The large parent inventory is updated at checkpoints or when the MD inventory / remaining-problem classification changes.
