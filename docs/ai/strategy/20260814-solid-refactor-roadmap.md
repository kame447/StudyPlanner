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

Next priorities:

1. Continue `src/components/` file-by-file audit.
2. Prefer dead-surface removal and behavior-preserving responsibility extraction before feature work.
3. Treat `NaturalLanguageAssistant.tsx` / `QuickEntryModal.tsx` separation as Issue #52, not an opportunistic mega-rewrite.
4. Treat raw-text weekly entry routing as Issue #115; do not add regex heuristics during refactor.
5. Keep trace/privacy, cross-device approval, personalization and saved-preview migration concerns in their existing Issues rather than mixing them into structural loops.

Loop rule:

Every completed loop must update this roadmap and `docs/ai/tasks/20260814-solid-file-by-file-refactor-and-md-inventory.md` before the next code file is started.
