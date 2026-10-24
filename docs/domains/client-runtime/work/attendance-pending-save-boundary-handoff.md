# Attendance pending-save boundary

Status: existing PR #822; current-main verification in progress.
Base: main `22e42203a4df82b5432d4290b7b5ea3a4246b8c9`.
Branch: `refactor/attendance-pending-save-boundary`.

## Evidence and scope

The merged #729 / `d88b1ee3` repair waits for hook-admitted writes before reopened attendance history reads. Its historical evidence and bounds remain in [attendance-read-lifetime-handoff.md](attendance-read-lifetime-handoff.md). Current main contains that fix. No new production bug is claimed.

The hook also owned module-wide repository/owner/lesson coordination. Extract that shared application-lifetime ownership into `src/services/classAttendancePendingSaves.ts`; keep React admission, loading, retirement, error publication and the drain loop in the hook. Only unsettled signals are retained, not history or storage data. No persistence schema, storage selection, domain record, UI, date or repository contract changes.

## Alternatives and falsifiers

1. Keep the coordinator embedded in the hook. Behavior is already correct, but its cross-instance ownership remains coupled to React and difficult to characterize independently. Baseline component tests remain essential regardless.
2. Extract only pending-save registration and read-only snapshots (selected). Minimal boundary; direct scope and admission tests, with unchanged hook await/check ordering. Any changed empty-scope list dispatch timing, stale publication, blocked unrelated scope or rejection deadlock falsifies preservation.
3. Move the whole wait into an async service or add a generic queue. Rejected: an unconditional await adds a microtask to the empty path; moving retirement into the service mixes React lifetime with persistence coordination. A generic queue would also imply unsupported write serialization.

## Invariants and limits

- Exact repository identity, owner and lesson tuple isolate pending sets. Snapshot arrays cannot mutate ownership.
- The hook rechecks after each settled batch, since a new save can join while awaiting the prior batch.
- Success, rejection and synchronous save exceptions release the signal through the unchanged finally block.
- Layout retirement remains before passive cleanup; no-work history reads gain no await.
- No timeout, cache, cross-tab coordination, rollback or new direct-write guarantee is introduced. Permanently pending saves remain pending.
- Finish callbacks remain internal one-shot settlement callbacks, invoked from the hook finally block.

## Verification

Five new direct coordinator cases supplement the unchanged real component/local persistence regressions. Existing suites cover success, rejection before/after persistence, synchronous throw/retry, remount, owner/class/repository isolation, multiple writers, layout retirement and retained complete history.

Focused command (exit 0): `npm run test:run -- src/services/classAttendancePendingSaves.test.ts src/components/TimetableClassDetail.pendingSave.test.tsx src/components/TimetableClassDetail.test.tsx src/repositories/classAttendanceRepository.test.ts src/repositories/firebaseClassAttendanceRepository.test.ts` — 5 files / 40 tests passed. Log: `/tmp/attendance-boundary-focused.log`. New coordinator tests: 5 passed; unchanged reopen component regressions: 13 passed. Independent exact source review found no blocker and confirmed equivalent synchronous Promise.all snapshot semantics and unchanged empty-path timing.

Environment: Node 24.19.0, Vitest 3.2.7. Dependencies reused from the integration owner's fresh current-main `npm ci` seed at `calendar-domain-refactor-work/node_modules`; exact lockfiles compared equal, SHA-256 `ea546daa78b887f737da4cfb1884b8f14f7b39ce4baa639e7baa04d5bfb6c693`. Scope tested: base above plus the hook and two new service/test files in this candidate. After testing, only whitespace, a source comment and this documentation changed. `git diff --check` passed. Full app/Worker types, full unit suite and production build are the integration owner's gate on the combined exact content; focused success alone is not completion. Browser, Firebase backend and physical-device validation are not claimed.

## Seven-perspective follow-up: defensive admission lifetime

Independent historical-hotspot review found a hook-contract gap: retaining the ready `save` callback, unmounting its hook and then invoking that callback returned `true` and persisted a real local attendance record. The callback previously adopted the lifetime at invocation instead of checking the lifetime that exposed it. Baseline RED evidence is `/workspace/shared/studyplanner-audit/attendance-retained-baseline.log`.

This is a defensive API boundary, not a demonstrated ordinary-user incident. Production detail is keyed by owner/lesson, uses a stable repository singleton, and immediately invokes save from the form handler. No supported browser path retaining this obsolete callback was found. Existing admitted writes must still settle normally.

The callback now captures its render's lifetime and rejects admission after retirement. Retry participates in layout retirement to close the commit-to-passive-loading interval. No new owner state or global abstraction is introduced. Same-scope benign rerenders and successful saves preserve callback validity; refresh, owner/class/repository changes and A→B→A do not revive obsolete callbacks. Loading callbacks cannot save.

Architecture, persistence, state ownership, async lifetime, date/schema compatibility, UI reachability and regression strength were independently audited. Date/schema/UI layout remain unchanged. Six new admission cases passed, including a real local-storage unmount case, loading/ready transitions, A→B→A and valid same-scope reuse. The six related files passed 46 tests before a type-only test annotation correction and extra A→B→A assertions; the final admission file then passed all six cases again (`/tmp/attendance-admission-final.log`). Independent exact guard review found no blocker. Full verification remains required on the final candidate.

## Final local verification receipt

`npm run verify` exited 0 on exact commit `bfe81ccee34dd9688256298d77150f01a3e04cd9`, tree `819beaf55fdd3295f2fd95e90243c5acaee6c1a6`, with no initial tracked or untracked source changes. Fresh app and regenerated Worker typechecks passed; 1,056 test files / 10,539 tests passed (67 skipped, 1 todo retained), production build passed in 13.37 seconds. Log: `/tmp/attendance-full-verify.log`. Same canonical npm-ci dependency seed and lock identity above; standard telemetry-disabled environment, DEV_LAN_HOST=127.0.0.1, isolated Wrangler log `/tmp/attendance-verify-wrangler.log`. Full test run generated `.cache/j1-old-worker` historical-fixture output; no tracked source changed. The historical commit `070d25cbe14796aebb8168ac5425c93e3506df1c` exists locally, and its tests passed rather than being skipped or weakened.

Only this receipt documentation changed after verification. Locally verified, not published or merged. Browser/CI/backend evidence remains separate.


## Existing PR integration — 2026-10-24

Resume existing PR #822 and branch `refactor/attendance-pending-save-boundary`, with normal existing-branch publication and subsequent gated merge now authorized. Remote head `9f918bb8854819da200d520fd4e4520d9da4d556` merged cleanly with current main `aaac18833d2565d23bd7d5e68ffe0c962887c91b`, yielding integration `a18b5cb5dbf3e8989ec7e312dc6b62594e9c1590`. Original attendance implementation and tests are unchanged. The main advances for study-session finishing and scheduling-day projection are separate responsibilities; PR #821 independently owns schedule-form retirement. Current review threads are empty.

The previous unpublished checkout and dependency seed are unavailable in this restored environment, so historical local proof is not reused. Next: verify the restored dependency/runtime identity, focused attendance coverage and one fresh full `npm run verify`, then publish this existing branch and follow exact-head native gates. No new PR, persistence schema, UI layout, timeout/assertion relaxation or scope extension is proposed.


Fresh `npm run verify` passed (exit 0) on `74055d288cf305db502c2b4700b5380336de5556`, tree `97296301e936797cb8afaf65a281835e52d27f80`: fresh app/Worker checks, 1,079 test files / 11,320 tests passed (12 files / 67 tests skipped, 1 todo), build 13.40s. Six focused attendance files / 46 tests also passed. Logs: `/tmp/pr822-oct24-full.log`, `/tmp/pr822-oct24-focused.log`. Node 24.22.1/npm 11.9.0; fresh `npm ci` seed at main `aaac1883` copied privately after matching package and lock hashes. All 19,392 installed manifest entries matched before and after verification (manifest SHA-256 `a5f7820a16c0e68825ca9dfc1f329baea1f8acb359572efec32f3aad0a3edda0`). No tracked input changed; only generated historical-worker fixture and runner output. Telemetry disabled, loopback dev host, isolated Wrangler log. This receipt is documentation-only; native exact-head gates remain required before merge.
