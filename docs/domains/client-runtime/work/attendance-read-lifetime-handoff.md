# Attendance reads across an in-flight save

Status: locally verified candidate, publication unapproved
Updated: 2026-10-17
Branch: `fix/attendance-read-after-pending-save`
Base: `2995702eb293f42e8fa05ba7949f1439f92adff9`
Initial reproduction base: `bd71dcc888664a572033581d9e3bfbe2faabfcae`

## Confirmed problem and owner

Opening a lesson, submitting attendance, closing the detail while persistence is pending, then reopening that same lesson can accept pre-save history. The old hook correctly retires its result, but the new hook has already accepted the old list and receives no later update. A real component/hook/local repository reproduction persisted one attendance record while the reopened detail displayed zero. It issued two list calls and one save call. These are local repository invocations, not production Firestore billing measurements.

Fresh main/open PR/head/closed PR checks found no active successor to merged attendance PR #635. Its retained branch is historical. Current profile, preference, Bookshelf and release integration work is outside this scope.

## Options and falsifiers

1. Block closing/editing while saving. Small surface but changes supported navigation and can trap the user behind a slow write. Rejected.
2. Wait only for already-admitted same-repository/owner/lesson saves before the new detail's fresh list. Selected for evaluation: no cached records, no stale list accepted, unchanged close behavior and persistence authority. A different owner/lesson/repository being blocked, a failed save preventing the read, or an abandoned waiting hook dispatching a read would falsify the design.
3. Introduce mutation subscriptions and refetch after settlement. More lifecycle/state surface and an avoidable stale list, without a requirement for live cross-client attendance. Rejected for this bounded bug.

The existing owner+lesson React key disproves a separate apparent prop-change saving-flag issue. The pending-save reopen case uses supported close/open events and remains reproducible.

## Change and bounds

The attendance hook records only unsettled save promises in a weak repository-keyed map, partitioned by the exact owner/lesson tuple. A newly opened detail stays unread until those already-admitted saves settle, then calls the existing fresh list. Both success and failure release the barrier. A layout-owned retirement check prevents a closed waiting detail from dispatching a delayed list in the commit-to-passive-cleanup gap; the read itself remains in the passive effect. No returned history or error is cached and no shared planner bootstrap changes.

- A single close/reopen still makes two total list calls and one save. The second list now occurs after settlement and displays the persisted row, rather than the pre-save zero count.
- Repeated close/open while pending abandons obsolete waits instead of dispatching their known-stale reads. The regression covers three reopens, with only the final active detail reading after settlement.
- Same-scope history remains loading if persistence never settles. Closing/editing remains available; no timeout invents an authoritative empty history.
- This is local coordination of hook-admitted saves through the stable repository instance. Writes admitted after a list has already started, another repository instance, another tab/client, and direct repository writes are outside this guarantee. Existing Firebase owner checks and server-snapshot reads remain the authority.
- Owner, lesson and repository identity are isolated. All historical rows are retained; a 120-row correction fixture verifies no truncation.

## Verification and exit

Final runtime/test inputs were checked on main `2995702e`, after a normal fast-forward incorporated the unrelated #723 dev/preview security merge. That merge changes Vite/package test inputs, so the earlier base's focused/type results were not reused as the final result.

- Exact final test bytes against untouched `2995702e` runtime: selected reopen case fails after proving persisted1/displayed0, list2/save1. Twelve intentionally unselected cases are not passes. `artifacts/attendance-read/baseline-final-exact-test.log`.
- Candidate related tests: 6 files / 55 passed, exit0. New 13 cases cover success, pre-write rejection, post-write acknowledgement rejection, synchronous throw/retry, owner/lesson/repository isolation, abandoned waiter, repeated reopen, read failure/retry, full historical correction, multiple admitted writers, and unmount before passive cleanup. `artifacts/attendance-read/focused-final.log`.
- Fresh `npm run typecheck:app:full`: exit0. `artifacts/attendance-read/typecheck-final.log`.
- `git diff --check`: clean. Node24.19.0, React/react-test-renderer18.3.1, Vitest3.2.7, TypeScript5.9.3, Vite6.4.3, Firebase12.12.0, reused canonical installed dependencies.
- A review-driven lifecycle challenge reproduced an extra list in the unmount-to-passive-cleanup gap of the first candidate (1 expected failure, `unmount-gap-baseline.log`). Three lines of layout cleanup retired that waiter at commit; the 13-case and final related suites passed. This was a candidate defect, not a test failure hidden by weakening assertions.
- Independent source/diff/log review found no blocker. Its final exact-content receipt is maintained separately by the reviewer.

Related command:

```sh
DEV_LAN_HOST=127.0.0.1 npm run test:run -- \
  src/components/TimetableClassDetail.pendingSave.test.tsx \
  src/components/TimetableClassDetail.test.tsx \
  src/components/TimetableView.editorLifetime.test.tsx \
  src/hooks/usePlannerDataState.classScheduleCreation.test.tsx \
  src/repositories/classAttendanceRepository.test.ts \
  src/repositories/firebaseClassAttendanceRepository.test.ts
```

No production queries, Emulator, browser, Worker typecheck, full suite or build were run in this worker. The Firebase adapter unit suite is mocked SDK evidence; the reproduction uses real local storage persistence. Neither establishes billed Firestore reads or real backend latency. Integration/browser checks and publication approval remain separate gates. The prior pending-six release and the rejected same-Plan narrowing experiment are untouched.

Local exit: reviewed bounded fix, targeted and fresh type evidence, exact patch/receipt and clean commit. Any publication must preserve newer upstream changes and verify the combined content.
