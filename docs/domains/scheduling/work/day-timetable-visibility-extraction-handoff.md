# Day timetable visibility extraction

Status: latest-main targeted validation complete; publication and strict exact-head CI pending
Updated: 2026-10-09 UTC

## Purpose and boundary

Give Day its own default-on timetable auto-display setting. The browser stores each owner's choice under `study-planner-day-timetable:${encodeURIComponent(ownerId)}`. Month retains its existing hook and storage key. Day filters only `timetable-template` occurrences at its presentation boundary; saved/imported plans, Actual records, other views and AI availability are unchanged.

Runtime changes are limited to:
- `src/App.tsx`: connect the Day preference to settings and Day view.
- `src/components/AppSettingsGeneral.tsx`: independent Day control and save error.
- `src/components/DayView.tsx`: filter automatic timetable entries and dismiss hidden details.
- `src/hooks/useTimetableDisplayPreference.ts`: browser-local owner/view/session isolation, committed-session guards, and persistence-success-only updates.

The Month hook is byte-identical to main. No domain, repository, planner-data, Actual-history, single-occurrence cancellation, AI, CSS, package or lock changes are included.

## Previous integration identity

- Existing branch: `feat/day-timetable-visibility-extract`; no duplicate branch or Issue was created.
- Latest integrated base: main `32623e36f1ebf06058a16f6233514144dee467b3`.
- Integration point: `145bcd0b36135da9907271720abf24c39767f2c3`, tree `8aebc76c419bd5cdf28acb9b115afe82cafa50de`. Normal merges preserve history; the subsequent local commit records the tested browser coverage and this checkpoint.
- [PR #541](https://github.com/kame447/StudyPlanner/pull/541), current reference head `e2810e6d66727aa4b909c54aedd809f1a8183548`, includes cancellation and AI occupancy and cannot represent this display-only release. Its remote branch and draft PR remain untouched. A narrowly scoped independent PR is approved for the publication owner.
- Existing Month #464 / #465 and Day details #481 / #484 remain the baseline. Keep umbrella #483 open.
- The original private candidate `0d1768e8` and its historical evidence are retained separately; none of its test results count as new integration evidence.

## Previous main32623e36 integration verification (historical only)

- Focused checks: 17 files / 105 tests pass, covering Day/Month independence, storage absence/corruption/write failure/retry, owner/logout/ABA/unmount/suspended-render guards, saved timetable/Actual retention, hidden detail dismissal, mutation/import, and drag lifetimes.
- `npm run typecheck:full`: fresh non-incremental app and Worker checks pass; Worker runtime types regenerated. Wrangler's optional log-file destination was unavailable, but generation and the complete command exited successfully.
- `DEV_LAN_HOST=127.0.0.1 npm run build`: pass. The explicit loopback address avoids restricted network-interface discovery in this local environment; product configuration is unchanged.
- `node scripts/ci/check-bundle-budget.mjs`: all 8 unchanged guards pass. JS raw/gzip: 2,255,134 / 607,018 bytes. CSS raw/gzip: 484,881 / 81,548 bytes. Existing Vite chunk advisory remains.
- Installed manifests: 237 match the lockfile and remain byte-identical before/after verification. Node 24.19.0, npm 11.9.0, Vitest 3.2.7, Playwright 1.62.1. No install or dependency mutation.
- Final Day behavior: Chromium 3/3 and mobile-profile WebKit 3/3 pass without retry, skip or flaky result after the harness corrections below. Both widths exercise default ON, independent Month/Day settings, reload, failed save/retry, unchanged canonical/legacy schedule data, retained Actuals, read-only automatic details and saved-class drag/Undo/Redo/reload. External attempts are zero.
- Seven unchanged neighboring Chromium cases also pass on the same integrated runtime: Day detail click/tap, Month persistence at two widths, keyboard/double-tap timetable controls and direct time input. They were not rerun merely for Day-only test-harness edits.
- Real layout width, visual viewport, media width and reduced-motion state are asserted. Settings screenshots at 390/1280px were inspected in Chromium and WebKit. No clipped/overlapping Day/Month controls were observed. These are Linux browser-emulation results, not real iPhone/PWA proof.
- Independent integration-owner source review and representative screenshot review found no blocker. Final runtime hashes remained unchanged through these checks; only this documentation changed afterward.

## Browser harness diagnosis and corrections

Initial WebKit runs exceeded the unchanged 30-second behavior budget near reload. Running serially with top-level CI settings did not resolve that failure, so concurrent load alone was not accepted as its cause.

Two observed test-path issues were corrected without changing runtime behavior, action/assertion order, retry policy or the 30-second budget:
1. Routing every local static asset through the test process produced 41 intercepted/continued requests in each preference scenario. The guard now matches only HTTP(S) outside the exact configured application origin, including scheme/host/port boundaries, and aborts those requests. The zero-external-attempt assertion remains. Origin/lookalike/port/IPv6 probes and parsed-AST comparison checked this change.
2. Failed traces showed `reducedMotion: undefined` despite top-level `use.reducedMotion = reduce`. Installed Playwright 1.62.1 only forwards that option via `contextOptions`. This Day-only spec now uses `contextOptions.reducedMotion = reduce` and asserts the actual media query. Final traces show `reduce`, `ja-JP`, `Asia/Tokyo`. Shared fixtures and normal-motion startup-video regressions are unchanged.

Before/after evidence: local request continuations 41 → 0; first schedule-navigation time 12.53s → 6.40s at 390px and 5.92s → 3.58s at 1280px. Final WebKit cases passed with the unchanged behavior budget; reporter durations include setup/teardown. This is test-path evidence, not a claim of a product startup-performance fix. A local diagnostic-config attempt failed before WebKit page creation because its video option required unavailable ffmpeg; the corrected local config keeps optional video off and retains screenshots/traces. No browser assertion was bypassed.

## Approved shared CI infrastructure

Reuse only `.github/workflows/ui-regression.yml` from #540 commit `f7049f22b9049aa6a66aa26c007fe9a895254824`, SHA-256 `0f6e3e0fa36393e75de980398c2f19901ebbc982fe8f24834eccacd4a9821a2f`. This exact four-project partition preserves all cases/assertions, retry/fail-on-flaky, per-job 25-minute budget, and required aggregate check name. No #540 feature code is included. When the common workflow enters main, verify the duplicate diff disappears.

## Publication-owner next step and exit criteria

The local worker performed no public write, real AI, production Firestore action or branch deletion. The release owner must refresh current main and duplicate-PR state, publish the approved display-only branch, run full exact-head verification and all applicable CI/browser/visual/security gates, inspect review state, then perform the authorized merge and post-main checks. Full unit/integration, remote CI and Firestore emulator checks are still pending; focused/local evidence is not their substitute. Leave #541 and #483 open, and delete only this release branch after its integration is confirmed.


## Theme-main integration checkpoint — 2026-10-09

The same Day branch is now integrating main `77fd7085d0f0b1be662cf23589fb9517c557ead5` (merged theme PR #552). The previous local release point is `0372a03e180e775e5533023d9438561616ef11d5`. No new branch or PR was created. The only merge conflict is the mobile WebKit spec list; resolution retains Day visibility and both appearance specs, together with every prior entry. App/settings runtime changes merge without conflict. The shared #540 workflow is now byte-identical to main and disappears from the Day diff.

Fresh checks on this combined snapshot:
- 24 files /138 focused tests pass, including the new combined Day/Month/appearance callback regression, App boundary regressions and the existing appearance preference/provider/style/budget tests.
- Fresh non-incremental app/Worker type checks, Worker type regeneration, Vite build (17.08s) and every current bundle/optional-asset guard pass. JS raw/gzip: 2,257,328 /607,598 bytes; CSS raw/gzip: 491,880 /83,351 bytes. Optional CSS6,999B and font500,340B are unchanged. No budget or dependency change.
- New Day/appearance interaction cases pass at390/1280px in both Chromium and mobile-profile WebKit. They select the actual pixel theme in settings, verify the real font, preserve Day OFF and Month ON through reload, then restore standard appearance and Day ON without changing schedules or Actuals. All four screenshots were inspected with no clipping/overlap.
- Browser collection retains all386 matrix cases, including Day visibility and both theme specs. The current Day file contains five cases per selected engine.
- Initial local batch:9 passed /1 WebKit1280px settings-case timeout. A fresh isolated execution also reached30 seconds, later in the scenario. These failures are retained and are not relabeled as success.
- A detached pre-theme0372a03e control completed the same case. To avoid inferring causality from separate timings, one fixed A/B run then used the same current spec against both preview builds. The old and new builds both completed every assertion (26.9s /35.8s reporter totals including setup/teardown), with a verified30,000ms behavior budget, no retry and unchanged operations/assertions. The new build reached the final reload, complete storage-equality assertion and zero-external-attempt assertion. The extracted network helper and six setup/navigation helpers are AST-equivalent to the previous spec.
- Thus each of the10 distinct candidate browser cases has passing evidence across the batch and fixed comparison. This is not a claim that the initial10-case batch was green. No runtime fix or local speed improvement is claimed; the precise timing cause remains unresolved. Public exact-head CI with strict fail-on-flaky behavior is the acceptance gate.
- All tracked verification inputs and237 installed manifests were checked unchanged through these runs. Only this documentation was updated afterward. The same Library item holds the new source checkpoint with previous-main evidence separated.

UNVERIFIED: full exact-head unit/integration, remote CI and post-main checks remain with the publication owner. Keep #541 cancellation/AI occupancy excluded and #483 open. No public write, live AI or production Firestore operation was performed.


## Material-main integration checkpoint — 2026-10-09

The verified theme integration was finalized as `a5979ae8ceb4667ef039df658767cd349d97cae9`, tree `c3dba247072238e7056942d2115c76ef7c963e3e`. It is now being normally merged with main `8b86ae97a93a47b94a9b7d1ee55960f4635c762a` after material-name PR #553. This intervening main change is confined to BookshelfMaterialDialog's name-edit revision guard, its tests/checkpoint and explicit WebKit selections. App, Day, timetable preferences, appearance runtime, dependencies and workflows are unchanged. The one mobile spec-list conflict retains Day, material-name and both appearance files; the material desktop-WebKit selection is also retained.

Latest-main validation on merge `3e8da57bdc9c0e751838c242ebf4acddcdbb53a3`:
- New combined boundary checks:5 files /28 tests passed, covering material-name ordering, App material handoff, Day dialogs, timetable selection and the combined Day/Month/appearance control.
- Fresh combined production build passed (23.43s); all existing aggregate/per-chunk/optional-asset guards passed. JS raw/gzip:2,257,414 /607,571 bytes; CSS raw/gzip:491,880 /83,351 bytes. Limits were unchanged.
- All394 matrix cases collect. Both desktop/mobile material-name selections, Day visibility and both appearance specs are retained; no workflow diff remains.
- Day/appearance runtime, Day browser-spec bytes and existing browser support are unchanged from the theme-main snapshot. The independent BookshelfMaterialDialog is reached through the lazy BookshelfView route. This source/ownership boundary justifies reusing the previous Day/appearance browser evidence, including its explicit timeout and fixed-comparison caveats; no fresh latest-main browser pass is claimed.
- All tracked inputs and237 installed manifests were checked unchanged through the boundary run and build. Only this documentation changed afterward.

UNVERIFIED: fresh full types/unit/browser/visual/security CI for the published exact head, merge and post-main checks remain with the publication owner. The previous24-file/138-test and full-type results are identified with the theme-main snapshot; the latest28 boundary tests and build are separate evidence. No broad local rerun, public write, live AI or production Firestore operation was performed.
