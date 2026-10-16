# Bounded optional view preloading

Status: approved for publication; combined verification and native acceptance in progress.
Owner: client-runtime loading improvement under existing Issues #483/#542
Branch: `perf/bounded-view-preload`
Base: public main `56a8e522`, tree `9a4bf105d3c76b5290e24a2283669c14e0fbaca5`; local equivalent `a716b343fa1c0741a3ac215fbc862caacf841e27`

## Approved integration checkpoint — 2026-10-16

The owner has approved publication and main integration after browser verification. The following local implementation records retain their original test scope and historical limitations. Current release status is tracked in [Issue #542](https://github.com/kame447/StudyPlanner/issues/542#issuecomment-6209395456) and the four responsibility-specific PRs, rather than inferred from these earlier local measurements.

The original release composition was based on `56a8e52212b72074e99f092d91b1bef488bc365f`. After renewed approval, the integration preserves current main `da462379b2ef57d5028762da36a11e8976b5d9b6`, including #711, and the independently verified Actual first-save repair in [PR #712](https://github.com/kame447/StudyPlanner/pull/712) (tree `b6d03539705f8785d16ba4c9629b130222fb1610`). Publication of this loading release resumes only after that repair is adopted and delivery-verified. Month lazy loading and its bounded preload registration are accepted together; material detail reuse and corrected administrator CSS are additional independent review units in the cumulative release. Final combined full verification and native browser acceptance must complete before main integration. Existing capacity-budget failures remain separately deferred without changing thresholds. Physical-device speed is still unmeasured.

## Scope and preflight

The optional post-Home preload currently starts eight primary module loaders, waits for all of them to settle, and only then starts QuickEntry and OCR. One slow primary can prevent secondary warming after the other seven slots have emptied. The optional scheduler is not part of startup readiness and does not control foreground lazy imports.

Preflight read root AGENTS, the current client-runtime index and streak preload handoff, Issues #483/#542 and their latest returned comments, open/closed loading PRs, current open PRs, and matching preload/load branches. PR #700's streak addition is already merged and no active PR owns this scheduler improvement. Existing #696 motion work and #488/Jev work are excluded. New local branch is required for this distinct active change; no Issue, PR or remote write is created. Main is not changed.

Candidate comparison:
- Start all ten imports together: removes the barrier but increases peak pending loaders and contention, rejected.
- Start secondary after an arbitrary timeout: permits extra concurrent work precisely when primary loading is slow, rejected.
- Reuse settled slots under the existing eight-loader maximum: preserves primary ordering/start and starts secondary only when a slot is free, selected for controlled measurement.

Only `src/lib/preloadAppViews.ts` and its tests are assigned here. App boot/readiness, owner-specific data, saved drafts, and foreground error/retry owners remain unchanged. A separately owned MonthView lazy split may require one additional primary registration; keep it separate from the scheduler comparison and retain the eight-loader cap.

## Verification plan and exit

First reproduce the head-of-line wait using the actual scheduler and controlled pending imports, then compare secondary start times and maximum pending loaders against the original implementation. Cover warm reuse, failed imports, all-primary-pending behavior, optional scheduling/cancellation, and existing App owner/readiness boundaries. Native browser launch is already blocked in this environment by socket EPERM; do not retry identical launch conditions. Real network/device timing remains unmeasured.

Exit for this worker: minimal reviewed patch, focused checks and source identities supplied to the integration owner. The final combined verify/build, browser/CI and approval to publish remain integration-owner gates.

## Scheduler-only result — 2026-10-16

Implemented a fixed eight-worker queue over the existing ordered module list. A fulfilled or rejected loader frees exactly one slot; there is no timer that increases concurrency. The returned one-shot promise still waits for every loader to settle, and repeated pending/completed calls share it. Existing idle/250ms fallback and cancellation code are unchanged. No component mounts or data reads are added.

Before the runtime edit, the new actual-import regression suite failed three cases and passed one: a released slot, a failed primary, and finished secondary work remained held by the all-primary barrier. After the runtime edit, `DEV_LAN_HOST=127.0.0.1 npm run test:run -- src/lib/preloadAppViews.scheduling.test.ts src/lib/preloadAppViews.test.ts src/App.plannerDataRecovery.test.tsx` exited 0 (3 files, 24 tests). App owner/readiness/cancellation, optional code-only warming, delayed imports, failure isolation and warm batch reuse passed. `npm run typecheck:app` and `git diff --check` exited 0.

Controlled measurement executed the exact before/after scheduling functions with fake module latency, replacing only dynamic imports with controlled loaders. A 5,000ms streak import with other primary durations 100–800ms delayed QuickEntry/OCR starts to 5,000/5,000ms before; after they start at 100/120ms. Peak pending loaders stayed 8; total batch time 5,300→5,000ms; warm calls start no additional imports. With uniform 100ms primary durations, both secondary starts and total completion were unchanged. These are controlled scheduler measurements, not production/network/device latency claims. An import may request multiple CSS/shared JS assets, so a loader cap is not an HTTP connection or bandwidth guarantee.

Scheduler-only verified inputs: runtime SHA-256 `9b87fea10fbb32f0f84ff00c4e898c7292d19f40301883570f9b9ccd7f354dfe`, scheduling test `d7cd3a8b3eecb523ba4f373569266e2c58ebe04c868dbc6cade251bd2183468c`. Node 24.19.0, Vitest 3.2.7, TypeScript 5.9.3, Vite 6.4.3; reused the installed dependencies without installing/changing them. This is scoped feedback, not complete installed-file identity or full-tree verification. Full combined verification and native/browser delivery remain integration-owner work.

## MonthView registration — separate integration dependency

The startup owner is moving MonthView from App's static graph to its existing view Suspense boundary. This follow-up adds MonthView immediately after streak in the primary preload order; it must be adopted with that App split. It does not increase the fixed eight-loader cap. Consequently Bookshelf is ninth and begins after the first slot is released. Foreground navigation still imports directly and does not await this optional batch.

The same controlled test is recorded separately from the scheduler-only comparison. With the previously specified delayed primaries and a 300ms Month import, Bookshelf start moves 0→100ms, QuickEntry 100→120ms, OCR 120→180ms; the slowest 5,000ms primary and peak of 8 remain unchanged. With uniform 100ms primaries, Bookshelf starts at 100ms instead of 0ms while both secondary starts remain 100ms. This is an explicit background-warming tradeoff for fewer initial eager bytes, not a guarantee that every first navigation is faster. App-only byte measurements belong to the startup owner's record.

After Month registration, the two preload suites plus App planner recovery, StudyStreakPage, useStudyStreak, confirmedStudyHistory, firebaseStudyStreakRepository and firebaseRepositories.lazyStudyStreak passed: 8 files / 61 tests. `npm run typecheck:app` and `git diff --check` passed. Runtime SHA-256 `63831b1cb664e2d15eb5ad566c3704251dea5264a35d4d87009420f53781d744`; original preload suite `a10a00a84bc850c18cfa6fb67226d0ef52929acaf12ff87b47016810332004c0`; scheduling suite `ca20581c8a08a03de549fe1fdbbbb080bfb5090db547085b1edc75147d519ba5`. No full/build/browser result is claimed for this isolated worker snapshot; the combined App split and scheduler must be verified together by the integration owner.

## Boundary review and final worker feedback

Independent root code review found no blocking scheduler issue. The fixed cap and shared queue are explicit; synchronous loader throws are also isolated instead of aborting optional warming. Cancellation still cancels only an idle/timer callback that has not started. Once a batch starts, imports and subsequent queued code-only warming continue, as before; the queue does not gain authority to mount a screen, read owner data or save a draft. A dedicated test now pins this existing started-batch cancellation behavior.

Final focused feedback after that extra regression: the same 8 suites passed 62 tests; app typecheck and diff whitespace checks passed. Final scheduling-suite SHA-256 is `1b5f6c263e54587c6fb3d274b01525fc10ccdcac9aea9e57dcfe906b595c0f00`; runtime bytes are unchanged from the Month checkpoint above. The native cold/warm preload resource test now includes both StudyStreakPage and MonthView in its optional-module coverage. Its syntax check passed; browser execution was not attempted because the existing native socket-EPERM blocker is unchanged. Native test SHA-256 `4a842b4d1a0471a615542d66347c9f2ced1524bd6c49daad95c3c5d769ee4278`.

The startup owner's Month shell/request-lifetime acceptance remains a separate dependency. Do not adopt the Month registration/native expectation without its validated App split. No branch was published, no PR or Issue was created, and no branch was deleted. Existing Issues #483/#542 remain the tracking umbrellas; full combined tests, build, native acceptance and publication approval remain outstanding with the integration owner.
