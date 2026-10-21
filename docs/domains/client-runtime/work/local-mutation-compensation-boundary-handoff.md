# Local mutation compensation boundary

Status: independently reviewed local candidate; full integration verification and publication pending.
Base: `22e42203a4df82b5432d4290b7b5ea3a4246b8c9`.
Branch: `refactor/local-mutation-compensation-boundary`.

## Evidence and purpose

Historical #453 / #454 fixed unrelated successful writes being overwritten by delayed forward writes or compensation. Current main already serializes complete local repository operations by exact Storage identity. This change does not fix that bug again or introduce a new transaction guarantee.

Both `plannerRepository.ts` and `localScheduleEventAuthority.ts` contained identical `runRecoverableMutation` implementations, used by fifteen compound operations. Extract the identical body into one repository helper so rollback completion, original failure identity and rollback-failure diagnostics cannot drift between the legacy and canonical schedule adapters. All operation callbacks, labels, write order, owner validation, queue ownership and storage formats remain unchanged. The migration's different inline catch deliberately stays separate.

## Alternatives and falsifiers

1. Keep two identical helpers. No immediate behavior defect, but high-risk error/settlement policy remains duplicated across adapters.
2. Extract the exact existing helper (selected). Minimal testable error/settlement boundary; no generic orchestration or altered callback contract. A changed synchronous apply start, early settlement, changed thrown object/message, extra rollback, or changed queue release falsifies preservation.
3. Add atomic storage envelopes, per-key conditional rollback or a general transaction abstraction. Rejected: new schema/ownership requirements and broader recovery semantics are outside this behavior-preserving unit; #454 already explains the bounded serialized-facade guarantee.

## Seven-perspective audit

- Architecture: one adapter-local compensation policy, not domain persistence logic.
- Persistence: original writes and compensation retained verbatim; not crash-atomic, cross-tab or multi-device transactions.
- State ownership: per-Storage serialization remains in the local factory; no queue moved or widened.
- Async: apply runs before first await; rollback completes before operation rejection releases the factory queue.
- Dates/schema: no model or normalization changes.
- UI: error text and original thrown object preserved; no rendering/caller changes.
- Tests: direct deferred cases supplement existing real-storage forward/rollback/failure/concurrency regressions; no assertion relaxed.

## Verification

Focused command: `npm run test:run -- src/repositories/runRecoverableMutation.test.ts src/repositories/createLocalPlannerRepository.test.ts src/repositories/createLocalPlannerRepository.storageFailures.test.ts src/repositories/plannerRepository.test.ts src/repositories/localScheduleEventAuthority.test.ts src/repositories/recurringPlanMutationRepository.test.ts src/repositories/recurringMonthEventMutationRepository.test.ts`.

Exit 0: 7 files / 71 tests passed, including 6 new helper cases. Log `/tmp/compensation-boundary-focused.log`. Runtime extraction was mechanically checked against both identical baseline bodies before editing. Existing compound commands test forward/rollback serialization, failed compensation, durable unrelated writes and original error identity. No new production bug is claimed.

Node 24.19.0 / Vitest 3.2.7; current-main dependencies reused from fresh calendar-domain-refactor-work npm-ci seed. Lockfile SHA-256: `ea546daa78b887f737da4cfb1884b8f14f7b39ce4baa639e7baa04d5bfb6c693`. Full types/suite/build remain a final exact-content gate, coordinated by the integration owner. Browser, production backend and physical-device validation are not claimed. Publication remains unapproved.

Independent source review compared both removed bodies to the new helper and found no blocker: synchronous apply invocation, awaited rollback, original thrown value, compensation-failure priority and all fifteen call sites are unchanged.
