# Owner-return startup history confirmation

Status: locally verified candidate; publication is not approved
Base: `ef8d5ad9388eafb55dffba128291e81842eaa80d`
Branch: `perf/owner-history-read-confirmation`

## Evidence and scope

Ownership was checked on 2026-10-18 against the initial 24-open-PR inventory and the final 27-open-PR recheck and the latest #542/#164/#437 checkpoints. Prior #653 and #716 are merged. This is the combined full-startup A → B → A boundary, not a replacement for those optimizations. AI/Jev/#751/#759/#382 and the rejected same-Plan occurrence query are excluded.

The facade retained successful migration promises for every past owner, while the complete-history receipt revoked its marker on owner changes. A returning owner could load a fresh complete schedule and Actual history, then fetch both collections again for streak because its marker had not been reconfirmed.

A real repository bundle with a synthetic Firebase SDK mock reproduces the duplicate reads. For the returning A startup plus streak confirmation:

| Fixture | Before query calls | After query calls | Before returned query documents | After returned query documents | Direct document calls, before/after |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 Actual + 2 schedule events | 4 | 2 | 6 | 3 | 2 / 2 |
| 1,000 Actuals + 2 schedule events | 4 | 2 | 2,004 | 1,002 | 2 / 2 |

These are mock SDK operation counts and returned query documents, not production billed reads, latency or pricing. Both cases retain the Actual dated 2010-01-01. No collection query shape, date range, normalization, Rules, index or transaction authority changes.

## Chosen boundary

- Share unfinished migrations by owner, including pending A → B → A. Starting a second A migration could let an old local snapshot overwrite newer canonical changes.
- Reuse successful confirmation only for the last owner to call a schedule-authority API. After another schedule owner's access, re-enter through the existing idempotent `ensureMigrated` path.
- A late A completion cannot replace B's completion cache. Failure and rollout fallback remain retryable, and cleanup removes only its matching pending promise.
- Leave the complete-history receipt and all owner/day/mutation/metadata gates unchanged. Cached, pending-write or absent metadata still requires full server history; old issued spend authority remains invalid.

Three options were considered: refresh confirmation on schedule-owner return; retain past owners' marker facts alongside the existing promise map; or keep the current duplicate reads. Refreshing confirmation preserves current server-proof semantics without adding a second authority. An initial one-slot implementation was rejected after an adversarial test demonstrated duplicate pending A migration calls. Its red log is retained; the final design keeps the original pending-owner sharing.

## Verification checkpoint

- Corrected baseline: two count regressions fail as expected (query 4, not 2).
- Rejected one-slot attempt: pending A → B → A regression fails (three migration calls, not two).
- Final related repository suite: 94 tests pass across seven files. Fresh application typecheck (`tsc --noEmit --incremental false`) passes.
- Local adapter regression delays A migration across B and a returned A edit; one A migration is shared, the edit waits, and later marker reconfirmation does not reimport stale legacy rows.
- Independent source review found no blocker in the pending-map design and verified all six changed files, seven focused files, fourteen boundary inputs and ten evidence hashes. Its source receipt is `laplans-owner-history-read-independent-review-20261018/source-review.json` (SHA-256 `64aa7c63575b9fb956bf79552cb698806c50476875a186837d335678b9fa7468`); the final commit binding records this documentation-only status update.

Evidence directory: `/workspace/shared/laplans-owner-history-read-evidence-20261018`. `baseline-counted.log` is the authoritative before-count evidence. The earlier `baseline.log` contains a placeholder document metric and is not used for document counts. Earlier passing one-slot logs are superseded by the rejected race and final design.

## Limits and next step

This does not optimize sign-out/sign-in to the same schedule owner, or a B access that only reads Actuals and never calls the schedule facade. An owner return without a streak read pays one extra marker confirmation; savings are workload-dependent. Concurrent callers from different owners still follow the existing single-owner receipt rules and may conservatively refetch. The pending map remains owner-scoped until settlement, so an indefinitely pending migration stays shared as before.

No production access, Emulator, browser, full suite or build was run for this slice. The query/Rules/index shapes are unchanged. The local final receipt binds the commit, reviewed runtime/test bytes and verification logs. Publication requires approval; latest-main composition must retain other owners' changes. At the final ownership recheck main remained `ef8d5ad9`; newly opened #762 adds a separate read-authority model test and does not change this facade.
