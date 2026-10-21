# Attendance pending-save boundary

Status: local candidate; integration verification and publication pending.
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
