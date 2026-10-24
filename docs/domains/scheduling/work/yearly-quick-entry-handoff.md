# Yearly quick entry

Status: active

## Ownership and scope

- Base: `470808277be3744b7c2c7624247076d0e91b70f8`.
- Local branch: `feat/yearly-quick-entry`; no remote branch or pull request yet.
- Existing open/closed Issue and PR searches found no owner for this requirement. Historical #434 covers ordinary deletion recovery and #659 covers general-event scoped editing; neither owns quick-entry yearly rules. Open #687 owns `quickEntryDrafts.test.ts` projection assertions, so this task adds separate yearly tests without changing that file.
- Show schedule types in the order 時間指定 → Todo → 繰り返し, preserving the existing initial selection.
- Add 毎年 to quick entry using canonical recurrence rules, with save/reload, common day/week/month projection, scoped editing and deletion remaining consistent.

## Design decision

The legacy repeat field already accepts `yearly` and projects the same month/day. Structured recurrence rules currently lack yearly; simply adding the chip would normalize its rule to daily. A legacy-only empty rule list would avoid that normalization but leave scoped editing unsupported. Add yearly to the existing rule model and its normalization, projection and edit support instead of introducing a second authority or materializing future plans.

Preserve the existing leap-day semantics: February 29 occurs only in years that contain that date. No substitution to February 28 or March 1. Preserve existing expiry and excluded-date boundaries. No schema version, Firestore Rules, migration, natural-language parser or dependency change.

## Checkpoint

Implementation and focused verification are complete as recorded below. The integration owner performs final combined verification, native browser execution, and publication after the user's approval. Browser execution and authenticated production behavior remain unverified until separately recorded.

## Verified local implementation

The requested order and yearly choice are implemented. The existing default selection still follows `initialMode` and falls back to Todo. The existing canonical ScheduleEvent repository stores the yearly rule without materializing separate future Plans. Yearly legacy Plans gain the same scoped-edit/delete path; their old ordinary-delete regression was moved to the scoped failure/retry contract rather than dropped.

Focused command, exit 0: `DEV_LAN_HOST=127.0.0.1 npm run test:run -- src/lib/planRecurrence.expiry.test.ts src/lib/planRecurrence.yearly.test.ts src/components/QuickEntryModal.yearly.test.tsx src/components/DayPlanDeleteRecovery.integration.test.tsx src/components/QuickEntryModal.focus.test.tsx src/components/QuickEntryModal.lifetime.test.tsx src/lib/quickEntryDrafts.test.ts src/domain/recurringPlanMutation.test.ts src/repositories/localScheduleEventAuthority.test.ts src/domain/scheduleEvent.test.ts src/domain/scheduleOccurrence.test.ts src/lib/monthViewProjectionRecurrenceOverride.test.ts src/repositories/recurringPlanMutationRepository.test.ts src/repositories/firebasePlannerRepository.recurringMutation.test.ts src/repositories/scheduleEventAuthorityRepository.test.ts src/repositories/firebaseScheduleEventAuthority.test.ts src/components/DayTimeline.scheduleOccurrence.test.tsx src/components/WeekView.scheduleOccurrence.test.tsx src/hooks/usePlannerDataState.recurringLifetime.test.tsx src/domain/scheduleOccurrenceMutation.test.ts src/domain/scheduleEventBusyCompatibility.test.ts src/lib/monthViewProjection.test.ts`.

- 22 files, 196 tests passed. The 17 new tests cover form saving, canonical storage/reload, shared day/week/month occurrence identity, study/general events, initial mode, annual/leap-year boundaries including 2100, expiry, excluded dates, single/future editing and deleting, source immutability, and unbounded daily/weekly/monthly/yearly single-then-future editing through real repository saves/reloads.
- `DEV_LAN_HOST=127.0.0.1 WRANGLER_LOG_PATH=/tmp/laplans-yearly-wrangler-corrected.log npm run typecheck`: app and Worker typechecks, regenerated Worker runtime types, exit 0.
- `DEV_LAN_HOST=127.0.0.1 npm run build`: exit 0, 6.13 seconds; existing large-chunk warnings remain.
- `node --check tests/e2e/yearly-quick-entry.spec.mjs` and `git diff --check`: exit 0.
- Playwright discovery: Chromium 2 real-app cases (390/1280px) plus the yearly validation case; mobile WebKit 2 real-app cases. Discovery used the existing isolated 1.62.1 runner; CI uses 1.64. Browser execution, screenshots/visual acceptance, physical devices and authenticated production remain unverified. The integration owner's known local socket restriction was not retried or bypassed.

Environment: Node 24.19.0, TypeScript 5.9.3, Vitest 3.2.7, Vite 6.4.3, Wrangler 4.147.0. Package-lock SHA-256 `af5b37bbcc990a528621a18f545142430f8b9506460dde03f3f9be80fbb4b9ab`. Dependencies were reused without install/update; installed-package and generated-type identities are captured with the local patch evidence. `DEV_LAN_HOST` is an existing configuration override used because automatic interface discovery fails before tests start in this sandbox; no test or production configuration was weakened.

## Review correction and independent verification

The first candidate `eeb89c7d` missed an unbounded-series case: a bounded single-date override was incorrectly summarized as the whole series expiry, then applied to the base rule during reload. Five added daily/weekly/monthly/yearly/leap-day repository tests all failed before the correction and pass afterward. The summary now remains unbounded if any non-date rule is unbounded. Existing explicit-null normalization and already-corrupted historical records are not changed; this is prevention for normal new edits, not a data-repair migration.

The shared-boundary command `DEV_LAN_HOST=127.0.0.1 npm run test:run -- src/services/natural-language/__tests__/adapter.test.ts src/lib/naturalLanguageCsvTest.test.ts src/lib/studyRecords.test.ts src/repositories/firebaseScheduleProjectionReads.test.tsx src/repositories/scheduleSnapshot.issue542Audit.test.ts` passed 5 files / 37 tests. Combined with the 22-file run above, final focused verification is 27 files / 233 tests.

Independent review re-bundled the corrected runtime and passed 418,242 checks each in Asia/Tokyo and America/New_York: all real calendar dates across legacy/structured and finite/unbounded cases, single/future edit/delete with reload, chained edits and exclusions, year-crossing overnight entries, the 2100 leap exception, Actual retarget/deletion, and source/material preservation. An independent four-file / 23-test Vitest run also passed. The original P1 was reproduced and then verified fixed; no additional blocking defect was found. These checks do not replace native browser execution.

Next: final diff identity review, combined exact-content verification and the native browser cases before publication. The final full `verify`, CI, merge and post-merge deployment are the integration owner's responsibility and are not represented as complete by these focused results. No GitHub writes were performed in this worktree.
