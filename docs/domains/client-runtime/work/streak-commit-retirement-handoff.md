# Retire automatic streak writes at the committed owner boundary

Status: locally verified candidate, no publication approval
Current integration base: `5b1e7c84072f5d245ca8c1298cfadfacd19368a8`
Original verified base: `227daa12efacb0613089e091c06b1882f815cb8f`
Branch: `fix/streak-retirement-current-main`
Original candidate: `c8753e42b14bb788f459f3b4a4d5d889f097a11d` (preserved)
Related: #768 merged at `9ec72a10312a2d0d40fe8886a49dbcb75fd17a01`; its separate schedule-owner confirmation scope is preserved.

## Confirmed defect

The hook revoked its automatic-rest-day lifetime and abort signal only in passive effect cleanup. A pending Promise can resume after React commits an unmount or changed owner/active input but before that cleanup runs.

Two controlled reproductions use the actual hook:

- A complete read settles in this gap after unmount. The old hook starts one automatic `useRestDay` call rather than none.
- The real Firebase streak repository is held at its mocked transaction `get`. Unmount, a different owner, or inactive state commits, then `get` resolves before passive cleanup. All three cases call `transaction.set` for the old owner instead of rejecting.

The first reproduction fails once and the second fails in all three variants on the unchanged base. These are hook/repository mock observations, not production reads/writes or a full browser logout test. The App keys the streak provider by user ID; the authenticated root also replaces its keyed tree on session-epoch changes, so committed session replacement reaches this hook lifetime boundary.

## Minimal correction

A layout cleanup retires the hook lifetime and aborts its current controller at commit. Its dependency list matches the passive read effect (owner, day, repository, history slices, retry request and active state). The read and automatic protection loop still start in the passive effect. Passive cleanup remains idempotent and only clears its own controller reference.

This prevents a new automatic repository call after retirement, and makes the existing repository checks reject a pending transaction after `get` or before a callback retry. It does not cancel a write already sent to the server. The installed Firebase transaction runner also enqueues its commit after the application callback resolves: once the callback has staged its write and returned, that commit may proceed even if the network request has not yet been sent. The abort signal is checked at application boundaries; it is not a cancellation channel for the SDK queue. A repository that ignores the signal may finish an already admitted write; the retired hook ignores that result and cannot chain another automatic save.

Alternatives considered were moving the entire read effect to layout, and adding new global authentication state to the repository. Both change broader timing/authority than this demonstrated commit gap requires. The bounded hook cleanup preserves shared pending reads, current-day/history validation and repository owner authorization.

## What the prior evidence covered

The #768 94 repository tests directly cover completed A→B→A marker reconfirmation, full history and legacy retention, owner-scoped pending migration sharing, confirmed metadata, failed read/retry, forced refresh, mutation epochs and abort checks after fully flushed input transitions. They do not execute a Promise continuation between React's unmount commit and passive cleanup.

Existing `useStudyStreak.test.tsx` separately covers failed reads as unknown, visible retryable save failures, cached display after a failed background refresh, old-owner/fully-cleaned unmount rejection, inactive startup and input-change cancellation. Those tests use `act` to flush passive cleanup, so their passing result does not close this gap.

Existing native `study-streak-calendar.spec.mjs` covers local-adapter automatic protection, return/forward/reload and corrupt-rest-state retry. It contains no direct Firebase A→B→A query-count acceptance. No native or production execution was added here.

## Verification checkpoint

- Base read/unmount: 1 expected failure, automatic-use calls 1 instead of 0.
- Base held transaction: 3 expected failures, old-owner staged sets 1 instead of 0.
- Candidate: 47 tests pass across the four directly related hook, Firebase repository/in-flight, and streak page files.
- New regressions also cover callback retry rejection before a second `get`/`set`, a new same-owner mount completing the shared read with one valid save, and no save chain from an abort-ignoring repository after retirement.
- Fresh application typecheck (`tsc --noEmit --incremental false`) passes. Independent exact source review found no blocker and verified all changed source/test bytes, preserved prior test bodies, and the matching layout/passive dependencies. Source receipt SHA-256: `99a0d923e91cec8df8f72c7e290c0ff141f243484e0b9f379d8ceb827e749413`.

Local evidence directory: `/workspace/shared/laplans-streak-commit-retirement-evidence-20261018`. The two baseline logs retain the red failures. The local final receipt binds source/test hashes and the final focused log. No full suite, browser, build, production query, Rules/index change or external write is part of this local candidate.

## Latest-main composition (2026-10-18)

The original candidate is applied without runtime/test changes to main `5b1e7c84`. The three executable changes, four focused-test files and fourteen original boundary inputs retain their verified SHA-256 values. The new base contributes Auth pending-admission, #768 owner-return confirmation and material structure-save failure handling. Its seventeen changed paths are retained; only the domain README receives the additional streak handoff link.

Auth keeps the authenticated root and session-epoch replacement unchanged. The owner-return facade reconfirms completed schedule migrations while preserving pending owner sharing; it does not change the streak repository's issued-history, generation or transaction checks. Material structure preferences use a separate local-storage key and do not replace the App, streak provider or history arrays. The new-base composition therefore has no identified source conflict with commit retirement.

The 47-case and fresh application-typecheck evidence is from the original candidate. It is carried by exact affected-input equivalence, not represented as a new run on the combined main. No tests/build/browser were repeated for this source-only reconciliation. Latest-main composition and independent review are recorded separately from the immutable original receipts.

## Limits and next step

The verified boundary starts at React commit, not the instant a logout request is initiated or an auth notification is queued before rendering. The change does not offer cross-tab cancellation or rollback of an already submitted transaction. Native logout/StrictMode effect replay was not exercised; same-owner remount and source effect ordering are the available evidence.

The local source review and verification are complete; obtain approval before any new publication. Preserve #768 and other owners' changes on integration. The publisher owns its existing CI; do not rerun it for this audit.
