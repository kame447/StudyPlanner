# Home study-progress inclusion

Status: Home/report/shared-streak MonthEvent correction verified locally; release integration pending

- Branch: `fix/progress-inclusion-settings`; base: `70953efd`.
- Original PR #664 scope: Home progress only. The 2026-10-15 follow-up below also corrects shared record classification for Report, month-calendar study totals and study streak. Material progress and saved schedule data remain unchanged.
- Cause: Home uses a mixed display Plan projection, but the former progress predicate selected legacy Plan types (`study`, `mock-exam`, `cram-school`). General events and classes could therefore enter or leave metrics depending on their registration route.
- Use canonical ScheduleEvent kind, timetable provenance, and read-only occurrence source metadata. Do not infer kinds from titles or create a second aggregation.
- Default: study only. Two independent opt-ins include general events and timetable; timetable takes precedence regardless of the general-event setting.
- Apply the same membership to planned minutes, actual minutes, expected/actual minutes by now, percentage, missing actuals, and streaks in the Home model. Actuals retain existing normalization/deduplication and standalone/orphan behavior.
- Home read-only projections do not offer direct Actual input. Unimported timetable projections contribute scheduled minutes only. MonthEvents can have saved Actuals through Day view; those must be resolved by original source ID and follow the general-event opt-in. Elapsed time/checklists do not become completion, and direct missing-record prompts remain limited to Plan-backed items.
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

## 2026-10-15: MonthEvent actual linkage correction

- Active branch: `fix/nonstudy-actual-progress`; base / initial HEAD: `b4b82e57`.
- Scope: keep saved major-event Actuals out of Home study progress when the general-event opt-in is off. Preserve saved records and calendar visibility; no persistence change.
- Preflight: PR #664 is merged. Current open PRs and actual/progress branches do not contain this follow-up. The separate color-picker task owns editor/color UI, not this aggregation.
- Findings: DayTimeline creates right-column entries only from Actual records; `予定` in that column is a category label, not an auto-generated completion. Home uses synthetic projection IDs while those Actuals keep the backing MonthEvent ID, so normalization can misclassify a known general event as an orphaned study record.
- Correction: the previous statement that MonthEvents cannot receive Actuals was wrong. DayView creates a temporary Plan-shaped editor target using the MonthEvent ID; the saved Actual retains that original ID.
- The original Home-only patch is retained separately. The final shared normalization accepts original MonthEvents, identifies a known same-owner source as `month-event`/`other`, and preserves known Plan precedence plus genuinely unknown-source/standalone study records. Home applies its existing opt-in to that source; Report and month-calendar study minutes exclude it unconditionally.
- Report wiring includes day/week/month totals, lifetime, previous-period comparisons, breakdowns and charts. Month calendar events and Day actual selection remain visible. No saved Actual/MonthEvent mutations or schema changes.
- Home baseline: four focused failures, including expected 0 versus 270 minutes. Component baseline: actual summary 4h30m while off. Report baseline: day/week/month 330 vs expected 60 minutes; lifetime 600 vs 60. Month grid baseline: 330 vs 60.
- Follow-up verification: 10 affected test files / 94 tests passed. App typecheck passed; final rerun recorded with the local checkpoint. Includes all Home opt-in combinations, display range changes, standalone/orphan retention, deduplication, same-owner classification, rendered Home/Report component output, Day selection, and existing shared streak baseline.
- Source-backed classification is not an inference from titles. The user's production rows were not accessed; the original screenshots alone do not establish whether their row is MonthEvent-backed or Plan-backed.
- The shared-streak unit was implemented separately after explicit approval to recalculate historical learning/ticket projections, then integrated with the original source arrays forwarded from App to both provider and persistent header. Existing Actual and RestDay storage is retained.
- Exit: focused regression tests plus exact diff and app typecheck; integration owner owns combined/full/native/publish gates. No GitHub write is authorized in this task.

### Current follow-up verification environment

- Node v24.19.0, TypeScript 5.9.3, React/React DOM/react-test-renderer 18.3.1, Vite 6.4.3, Vitest 3.2.7.
- Dependencies use the existing approved integration installation; package-lock SHA-256 `af5b37bbcc990a528621a18f545142430f8b9506460dde03f3f9be80fbb4b9ab` matches this worktree. No dependency/config changes.
- Focused command: `DEV_LAN_HOST=127.0.0.1 CLOUDFLARE_CF_FETCH_ENABLED=false WRANGLER_SEND_METRICS=false DO_NOT_TRACK=1 VITEST_MAX_FORKS=2 VITEST_MIN_FORKS=2 node node_modules/vitest/vitest.mjs run src/lib/studyRecords.test.ts src/lib/learningReport.test.ts src/components/ReportView.test.tsx src/lib/homeScheduleAugmentation.test.ts src/lib/homeDashboard.scheduleSemantics.test.ts src/components/HomeLiveClock.test.tsx src/lib/monthViewProjection.test.ts src/lib/reportAnalytics.test.ts src/lib/studyStreak.test.ts src/components/DayTimeline.actualAppearance.test.tsx`.
- Full verify, build, live browser/account validation and publication remain integration-owner gates. The unit/component assertions are not visual browser evidence.

## Combined Home, Report, month-calendar and shared-streak checkpoint

- Branch `fix/nonstudy-actual-progress`, base `b4b82e578b777828fc87a0e4d87df306eeb4d652`. All changes remain local. Local commit creation was blocked by unset Git author identity; no global/repository identity was changed, and the exact patch is retained for the integration owner.
- The shared-streak dependency is a separate 19-file patch, plus two App wiring changes and one App-boundary regression. The model, repository, hook and persistent header use the same original MonthEvent sources. Missing MonthEvents cannot certify a complete reward history. Server-confirmed receipts/fingerprints and MonthEvent upsert/delete/recurring mutation invalidation include that source.
- Stored Actual/RestDay data, migrations and ticket schema are unchanged. The approved recalculation can reduce derived historical earned tickets/protected days. The existing automatic-use rule is unchanged and can select an ended date that becomes eligible after non-study records are excluded.
- Read-cost evidence: startup reuses its existing schedule snapshot + Actual reads, adding zero complete-history collection queries and one rest document read; unchanged same-owner/day/input reopening behaves the same. Fallback keeps two collection queries (Actual A documents and schedule P+M documents) plus migration/rest documents. It adds M MonthEvent documents compared with the former P-only query. MonthEvent-only saving invalidates all receipts: after its targeted M-document reload, the next streak confirmation performs that full fallback. Subsequent unchanged reopening reuses the cache. This is the pre-existing safety-first invalidation policy, not a new read-optimization scheme.
- Regression failures were confirmed before repair: three streak cases (non-study exclusion, past ticket/protection recalculation, automatic-rest candidate) and the App source-forwarding case. Unresolved-source and incomplete-history safety cases remained green.
- Final combined focused run: 25 test files, 200 tests passed, exit 0. Includes App source forwarding and navigation, Home/report rendered component output, month projection, shared normalization, streak UI/model/hook, local/Firebase repositories, receipt reuse, failed/cache/pending source reads, source-only mutation/abort, and canonical projection read footprints.
- `npm run typecheck:app:full` passed (non-incremental), exit 0; `git diff HEAD --check` passed. Source/test code was unchanged after this final run. Firebase-config warnings in isolated App tests are expected for the offline mocked repository; no live account was used.
- Independent reviewer found no remaining concrete issue after source tracing and separate assertions for recurrence, exclusions, moved/deleted source fallback, owner boundaries, input preservation, classification, historical tickets, completeness and stale-receipt rejection.
- No full verify, production build, browser/visual run, live-account mutation, GitHub push/PR/merge or deployment was performed in this task. Release owner must run applicable combined/release gates against their final integration snapshot.
- Data limit: truly deleted/unknown sources remain eligible under the existing orphan-study policy because their surviving Actual lacks authoritative kind. The fix does not infer category from titles or remove those records.
