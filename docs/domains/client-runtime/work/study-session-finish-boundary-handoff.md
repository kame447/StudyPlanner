# Study session finish measurement boundary

Status: active PR #818; current-main integration verification and native acceptance pending
Owner: client runtime; related product contract [Issue #190](https://github.com/kame447/StudyPlanner/issues/190)

## Scope and current checkpoint

Existing branch `refactor/ui-state-boundaries`, [PR #818](https://github.com/kame447/StudyPlanner/pull/818). On 2026-10-23, remote head `4c284e68b6412688afeab020ed6b88e1b7525330` was integrated with main `398ad1143ad36b742ad9cee076466688e42e44d7` without source changes or conflicts. The original implementation remains intact. Focused timer, Pomodoro and session regressions pass (122 tests across five files). Final-content full verification and native CI gates remain separate pending checks; current results will be recorded on the PR. Earlier snapshots below are historical evidence, not verification of this integration.

The finish action previously computed recordable elapsed duration, its separate storage minimum, first finite-Pomodoro completion instant, and local-date classification inside `StudySessionView`. A pure `getStudySessionFinishMeasurement` now owns that temporal projection with an explicit clock input. The component still owns phase admission, React/ref updates, draft creation/edit retention and persistence. This is not a newly discovered production bug or a new completion-accounting policy.

Historical contracts from [#610](https://github.com/kame447/StudyPlanner/pull/610), [#664](https://github.com/kame447/StudyPlanner/pull/664) and current tests remain: pauses are excluded, Pomodoro rest is included, explicit finite sets cap measurement, automatic goals do not cap it, measured time has a 1-second floor, stored ranges have a 1-minute floor, and genuine wall-clock midnight crossings differ from a next-day click after an earlier completion. Existing completion timestamps remain authoritative.

Alternatives considered: settings-hook extraction risks stale callback/layout ordering without a compelling simplification; notification timer deduplication has weaker historical evidence; the chosen pure finish boundary is small and directly falsifiable by regression tests. It would be wrong to claim this fixes suspension/recovery bugs or proves native rendering.

## Exact candidate evidence

Source/test SHA-256 after focused tests and fresh app typecheck:

- `src/components/StudySessionView.tsx`: `f483a8496e04c24b3e165f3d98d435bdb0858b454fcd793e29f08176f422b578`
- `src/lib/studySessionFinish.ts`: `3205a8fff304da249833af3fdb81d73c16b9b7703c0117fb90d4203bb5590493`
- `src/lib/studySessionFinish.test.ts`: `ebc03616bb3b471fd9f236d9bd9efba48a8868be24094f45eaceafb758090300`

Only these three source/test paths and this checkpoint/domain-index link differ from base. Both independent reviews found no blocker across architecture, persistence, state, asynchronous lifecycle, dates, UI and tests. Settings admission/revision guards, paused-draft merge, storage generations and UI markup are untouched.

- `DEV_LAN_HOST=127.0.0.1 TZ=UTC npm run test:run -- src/lib/studySessionFinish.test.ts src/lib/pomodoroSessionTracking.test.ts src/components/StudySessionView.unplanned.test.tsx`: exit 0, 80 tests across 3 files (13 new pure measurement tests, 7 existing tracking tests, 60 existing component tests).
- `npm run typecheck:app:full`: exit 0, fresh non-incremental app check.
- `git diff --check`: exit 0.
- Earlier focused attempt did not start because sandbox `networkInterfaces` failed in the LAN URL plugin. An escalation attempt failed before execution. The supported explicit `DEV_LAN_HOST` value resolved startup without changing source/test assertions.

Environment: Node 24.19.0, Vitest 3.2.7, Vite 6.4.3, TypeScript 5.9.3, React and test renderer 18.3.1. Dependencies reused the integration owner's canonical calendar-worktree `npm ci` installation; candidate and seed package-lock SHA-256 both `ea546daa78b887f737da4cfb1884b8f14f7b39ce4baa639e7baa04d5bfb6c693`. Installed `.package-lock.json` hash `8723ba5cfaf3e7aee4f8490dc7bb2edd56aedda4035944664531204a5d03b000` and versions identify this feedback run, not permission to reuse a future full verification after dependency/input changes.

## Pre-verification checkpoint and exit criteria

Integration owner combines independent candidates and runs exact-content `npm run verify`, including fresh app/Worker types, full tests and production build. Focused tests and app types above are not a full integration pass. Required CI/native browser acceptance remains separate and unexecuted for this candidate. Do not publish/merge or describe the overall task as complete based on this checkpoint. Reconcile any changed base and retained PR ownership before publication; upstream/main/merge actions require the user's applicable approval.


## Full local verification — 2026-10-20 23:50 UTC

Verified implementation `86ad5b1cde1cc8a1cd6c6a210b1334c529209d18`, tree `5de41673cb0d0dc9d0e1289fc8a4ef4e54222841`. `npm run verify` exited 0: fresh non-incremental app/Worker checks, regenerated Worker runtime types, 10,541 tests passed / 67 skipped / 1 todo (1,055 files passed / 12 skipped), production build 14.04s. Skips/todo remain unexecuted.

Environment used `TZ=UTC`, `DEV_LAN_HOST=127.0.0.1`, `DO_NOT_TRACK=1`, `WRANGLER_SEND_METRICS=false`, `WRANGLER_SEND_ERROR_REPORTS=false`, `WRANGLER_HIDE_BANNER=true`, `WRANGLER_NO_SKILLS_UPDATE_PROMPTS=true`, `CLOUDFLARE_CF_FETCH_ENABLED=false`, and a temporary Wrangler log path. All tracked inputs remained unchanged; only test-generated `.cache/` appeared. All 19,392 installed dependency files were inventoried before/after excluding disposable `.cache`, `.vite`, `.vite-temp`: no differences, sorted inventory SHA-256 `f3337a266db7d5caef79631673be639556310492a97b7bb8bae0e751547edbd1`.

Both independent reviews found no blocker. This proof/status update is documentation-only. Remaining gates: applicable integration, native/CI acceptance and publication authorization. Full verify did not execute native browser or Firestore Rules checks. No publication, main edit or merge performed.
