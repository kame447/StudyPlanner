# Class schedule commit lifetime

Status: active PR #821; current-main integration verification in progress
Branch: `fix/class-schedule-commit-lifetime`
Base: `22e42203a4df82b5432d4290b7b5ea3a4246b8c9`

## Confirmed defect and bounded correction

An admitted class-related schedule save can resolve after its form has been replaced but before passive effect cleanup. The old form still considers itself mounted and invokes its close callback. Through the actual enabled Record action in class details, this dismisses the new attendance form. Existing tests awaited cleanup before resolving the old save and therefore missed this commit-phase window.

`TimetableClassScheduleForm` now retires its existing mounted guard in layout cleanup rather than passive cleanup. The production change is exactly the hook import and its invocation. Save admission, validation, payloads, rejection text, draft retention, close ordering and other attendance/detail code are unchanged.

Alternatives considered: moving retirement to layout cleanup directly addresses the reproduced window; migrating to the shared editor admission gate would also change retained-submit behavior beyond this fix; disabling unrelated replacement controls would alter supported UI behavior without addressing lifecycle ownership. The first is the narrowest correction. If the new test only invoked an impossible stale callback, or if Record were disabled during save, the user-flow interpretation would be wrong; the integrated regression explicitly proves the Record control is enabled and invokes it before the old promise resolves.

## Regression evidence

Dedicated `TimetableClassScheduleForm.lifetime.test.tsx` has three tests:

1. An admitted save cannot call dismissal after unmount commit before passive cleanup.
2. Same-render duplicate submission is rejected; current-save failure preserves the draft and a successful retry dismisses exactly once.
3. The actual enabled Record action replaces the pending schedule form with attendance; old schedule completion must not dismiss that replacement.

On original code: two lifecycle tests fail (one obsolete close invocation; replacement form unexpectedly disappears), while the retry test passes. On the two-line fix: all 23 tests pass across the new file, existing `TimetableClassDetail.test.tsx` and `TimetableClassDetail.pendingSave.test.tsx`. The test deliberately does not flush passive cleanup with `act` between replacement commit and old promise settlement; ordinary setup/teardown still flushes effects. No timeout, test assertion or production protection was weakened.

Command: `DEV_LAN_HOST=127.0.0.1 TZ=UTC npm run test:run -- src/components/TimetableClassScheduleForm.lifetime.test.tsx src/components/TimetableClassDetail.test.tsx src/components/TimetableClassDetail.pendingSave.test.tsx`, exit 0 on the fix. Node24.19.0 / Vitest3.2.7 / React18.3.1, canonical current-lock npm-ci dependency seed. Independent report-domain review found no blocker in the two-line fix or real consumer-flow reproduction.

## Pre-verification checkpoint and exit criteria

Freeze this candidate and let the integration owner run exact-content `npm run verify` with fresh app/Worker types, full tests and build, followed by applicable native/CI acceptance. Focused React tests establish the lifecycle defect and correction; native browser timing remains unverified. No publication or main/merge operation has occurred. The independent UI-finish, Quick Entry and attendance candidates are separate snapshots; do not reuse their verification as this candidate's full proof.

## Full local verification — 2026-10-20 23:45 UTC

Verified implementation commit `9b71504a81254b79e691f72690e799ce0682d084`, tree `0afd306bbc1e0adcd4559eb6c7f4ff6681c1e8a2`. `npm run verify` exited 0: fresh non-incremental app and Worker checks, Worker runtime type regeneration, 10,531 passing tests / 67 skipped / 1 todo (1,055 passing files / 12 skipped), production build 12.99s. The 67 skips and 1 todo remain unexecuted; no claim of their acceptance is made.

Environment used `TZ=UTC`, explicit `DEV_LAN_HOST=127.0.0.1`, telemetry/optional network disabled with `DO_NOT_TRACK=1`, `WRANGLER_SEND_METRICS=false`, `WRANGLER_SEND_ERROR_REPORTS=false`, `WRANGLER_HIDE_BANNER=true`, `WRANGLER_NO_SKILLS_UPDATE_PROMPTS=true`, `CLOUDFLARE_CF_FETCH_ENABLED=false`, and a temporary Wrangler log path. Tracked input bytes remained unchanged. Verification generated only an untracked `.cache/` directory. All 19,392 installed dependency files were inventoried before and after (excluding disposable `.cache`, `.vite` and `.vite-temp` directories): no differences; canonical sorted inventory SHA-256 `f3337a266db7d5caef79631673be639556310492a97b7bb8bae0e751547edbd1`.

Both independent reviews found no blocker. This checkpoint addition is documentation-only and does not invalidate implementation evidence. Remaining gates are integration/publication authorization and applicable browser/CI acceptance; full local verification is not native-browser or Firestore Rules execution. No publication, main edit or merge performed.


## Resumed integration — 2026-10-24

The owner authorized normal publication to the existing branch and merge after verification. Continuing remote head `845dbb8b578acdf36660d717d76e059a3bd3ce30` on `fix/class-schedule-commit-lifetime`, PR #821, after checking current PR discussion and competing branches. Main `aaac18833d2565d23bd7d5e68ffe0c962887c91b` is integrated normally; the only conflict is a documentation-index union retaining both links. Production remains the two-line layout-effect change, with original three regression tests unchanged. No replacement PR or expanded admission policy.

The previous local worktree and dependency seed are unavailable in the restored execution environment. Historical local verification therefore is not reused. Next: fresh dependency identity, focused regressions, one coordinated final full verification, exact-head native gates and serialized merge. Retained post-unmount submission admission remains outside this fix; pending persistence is preserved, while unmounted UI continuations are retired. Layout setup reactivates the mounted flag for effect re-setup, and actual parent detail identity is keyed by owner and lesson. This source review is not a claim of native StrictMode timing reproduction.

### Exact-content final local verification

`npm run verify` exited 0 on `15f0955a95b6c3d21d262585d742dff2b75162b8`, tree `8bf6f2b0e8eadcffbbb8a3a4cbfe634a2e8aa6a2`, integrated with main `aaac18833d2565d23bd7d5e68ffe0c962887c91b`: fresh app/Worker checks and runtime-type regeneration; 11,312 passing tests across 1,078 passing files; production build 13.58s. The 67 skips, 12 skipped files and 1 todo remain separate. The focused three files also passed 23/23. Local supplied Node 24.22.1/npm 11.9.0 passes the repository runtime guard; native CI pins Node 22.23.4.

Fresh npm-ci dependency seed matched package/lock hashes and all 19,392 installed entries before use, copied without shared hardlinks. All 3,061 tracked inputs, installed entries and Node bytes remained unchanged across verification; generated `.cache/` is untracked and excluded. Verification used UTC, loopback DEV_LAN_HOST, telemetry disabled and a per-worktree Wrangler log. The source diff remains the original two-line production correction and unchanged three regressions; this result addition is documentation only. Remote native CI and merge acceptance remain pending, not inferred from local verification.
