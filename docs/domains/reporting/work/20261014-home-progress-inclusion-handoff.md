# Home study-progress inclusion

Status: implementation verified locally; integration pending

- Branch: `fix/progress-inclusion-settings`; base: `70953efd`.
- Scope: Home progress only. Reporting, material progress and saved schedule data are unchanged.
- Cause: Home uses a mixed display Plan projection, but the former progress predicate selected legacy Plan types (`study`, `mock-exam`, `cram-school`). General events and classes could therefore enter or leave metrics depending on their registration route.
- Use canonical ScheduleEvent kind, timetable provenance, and read-only occurrence source metadata. Do not infer kinds from titles or create a second aggregation.
- Default: study only. Two independent opt-ins include general events and timetable; timetable takes precedence regardless of the general-event setting.
- Apply the same membership to planned minutes, actual minutes, expected/actual minutes by now, percentage, missing actuals, and streaks in the Home model. Actuals retain existing normalization/deduplication and standalone/orphan behavior.
- MonthEvent and unimported timetable projections cannot receive Actual records. Opt-in adds their scheduled minutes only; elapsed time/checklists do not become completion, and impossible missing-record prompts are suppressed. Saved Plan-backed items can contribute actuals normally.
- Week projection must include the beginning of the current week, not just today onward, while preserving the upcoming schedule window and deduplication.
- Preferences use the existing owner-isolated, browser-local settings lifecycle. No migration or saved Plan/Actual/MonthEvent writes.
## Verification

- Focused Vitest: 4 files / 19 tests passed, exit 0. Files: `homeDashboard.scheduleSemantics.test.ts`, `homeScheduleAugmentation.test.ts`, `useStudyProgressPreference.test.tsx`, `AppSettingsGeneral.appearance.test.tsx`.
- `npm run typecheck:app`: passed, exit 0 after correcting the new test fixture to use the existing checklist `checked` field.
- `git diff --check`: passed.
- Environment: shared installed dependencies via the approved integration worktree's `node_modules`; Vitest 3.2.7. Config startup initially hit the container's `uv_interface_addresses` limitation. The existing `DEV_LAN_HOST=127.0.0.1` override resolved it; no config or test weakening.
- Test environment additionally sets `CLOUDFLARE_CF_FETCH_ENABLED=false WRANGLER_SEND_METRICS=false DO_NOT_TRACK=1 VITEST_MAX_FORKS=2 VITEST_MIN_FORKS=2`.
- Regression evidence covers all four inclusion combinations, Actual-only completion, unchanged stored inputs, standalone/deduplicated study actuals, pre-today weekly occurrences, imported timetable deduplication, independent settings persistence/reload/owner revocation, and failed storage writes.
- Integration owner owns full verify/browser/publish. No browser session, full suite, build, GitHub write, or shared-history change was performed by this worker.
- Next: integrate this commit and run the combined snapshot's applicable gates. Separate material-detail zero-percent and circular-progress styling requests are not part of this change.
