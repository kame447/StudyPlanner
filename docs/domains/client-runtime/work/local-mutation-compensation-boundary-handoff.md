# Local mutation compensation boundary

## Current repository status (2026-10-24)

[PR #823](https://github.com/kame447/StudyPlanner/pull/823) merged into `main` on 2026-10-24 UTC as `66f8295814c033022dbd0730e317c1d978f7101f`. The merge is present in the inspected main snapshot `382fdff2a5ee98850aea2eb369eeaeee420d636d`.

The checkpoints below retain their original source, verification and authorization limits; their pending publication/merge statements are historical, not the current queue. This status correction claims no new test, device or deployment verification. Paths are retained; archive relocation and invariant transfer are outside this change.

## Preserved implementation and verification checkpoints

Status: locally verified and independently reviewed; publication pending.
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

## Final local verification

`npm run verify` exited 0 on exact commit `a762fba867a4c44d46bbbf3a4710577a491727f5`, tree `5a42362ff81c218b3b353b728b2337ecc25138b6`, initially clean. Fresh app/Worker typechecks, 1,055 files / 10,534 tests passed (67 skipped, 1 todo retained), production build passed in 13.12 seconds. Log `/tmp/compensation-full-verify.log`; standard telemetry-disabled environment, DEV_LAN_HOST=127.0.0.1, isolated Wrangler log `/tmp/compensation-verify-wrangler.log`. Same dependency identity above. Tests produced `.cache/j1-old-worker` historical-fixture output but no tracked source changes. Only this verification receipt changed afterward. A second historical-hotspot reviewer independently confirmed byte-identical helper bodies against both original adapters and no source blocker. No publication, merge or browser/backend acceptance claimed.

## Resumed current-main validation (2026-10-24)

Continue existing PR #823 and `refactor/local-mutation-compensation-boundary` from remote `dfb98b0a4d61e24d09b33baed519366a137a6d89`; current main `aaac18833d2565d23bd7d5e68ffe0c962887c91b` integrates without conflicts at local `647fb836927cd613eb1f004ca11e8386196a5fbb`. The prior local workspace and verification artifacts are unavailable after environment reset, so previous validation is historical only and new verification is required. Current-main source comparison again confirms byte-identical helper bodies; all 15 callbacks, ownership preparation and queue boundaries are unchanged. No additional implementation change is warranted. No unresolved review threads were returned. Publication and merge are now approved for this existing PR, subject to normal verification gates; no direct-main push, force push, branch deletion, or replacement PR.

Next: verify the integrated candidate with a freshly established dependency/runtime identity, publish by normal push, and require terminal native CI before the integration owner serializes merge. Local focused and full verification are pending; no completion claim is made.

### Fresh resumed verification

On clean commit `764a1ca49182b37d15d5ee6cd342793482021db5`, tree `f9db2a6eed207e358195859eca7ac695121c484e`, fresh `npm run verify` exited 0: non-incremental app and regenerated Worker types, full unit/integration tests, and production build passed. The seven-file focused suite also passed all 71 tests. Runtime: supplied Node 24.22.1/npm 11.9.0, accepted by the repository guard (remote CI separately pins Node 22.23.4). Dependencies were independently copied from fresh successful `npm ci` and `npm ls --all` seed; package SHA-256 `263ceee1209973904638c558e426537de4d4cecc285b449b748e9be55a1f7640`, lock SHA-256 `01cc6c380a2797653d6e9a9dca8e5afe835a2278cb990d21dc6b220ca8aa466f`, full installed-file manifest SHA-256 `a5f7820a16c0e68825ca9dfc1f329baea1f8acb359572efec32f3aad0a3edda0`. Logs: `/tmp/pr823-resumed-focused.log`, `/tmp/pr823-resumed-verify.log`; manifest `/workspace/shared/studyplanner-seed-content-manifest.json`. Environment: `DEV_LAN_HOST=127.0.0.1`, `WRANGLER_SEND_METRICS=false`, isolated Wrangler log. Generated test-cache output does not alter tracked inputs. Only this receipt changes after verification. Integrated-head native CI remains required before merge.
