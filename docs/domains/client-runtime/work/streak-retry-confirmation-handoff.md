# Scope a successful streak retry to its explicit request

Status: approved and published as #774; latest-main integration awaits its own CI
Original verified base: `5b1e7c84072f5d245ca8c1298cfadfacd19368a8`
Branch: `perf/streak-retry-force-scope`

## Reproduced read duplication

A successful explicit retry left `request.force` true until a focus/pageshow/visibility refresh changed it. Subsequent history-array changes in the same mounted hook therefore bypassed even a newly complete server-confirmed history receipt.

A real `useStudyStreak` hook and Firebase streak repository, with the Firebase SDK mocked, reproduce this sequence: an initial rest-document read fails, the user retries successfully, an owned mutation invalidates the receipt, and replacement full owner snapshots reconfirm it. The subsequent hook update unnecessarily reads the complete Actual and schedule collections again.

For a synthetic fixture with 1,000 Actuals, one 2010 Plan and one weekly MonthEvent starting in 2000, the measured subsequent confirmation changes as follows:

| Operation | Before | Candidate |
| --- | ---: | ---: |
| SDK query calls | 2 | 0 |
| SDK direct-document calls | 2 | 1 |
| Total returned documents in the mock | 1,004 | 1 |

All 1,000 Actuals and both historical schedule sources remain in the accepted result. The remaining direct read confirms the current rest-day document. These are SDK/mock operation counts, not measured production billing or an assertion that every post-save refresh can avoid full history reads.

## Minimal correction and alternatives

The hook records the request object only after that request returns a complete, matching-owner history while the hook lifetime is still current. Later input updates no longer inherit the satisfied request's forced mode. Every new explicit retry has a different request object and still forces confirmation. Failed, unfinished, inactive or retired requests do not become confirmed.

Alternatives considered:

- Resetting request state after success would trigger another effect/read solely to clear the flag.
- Consuming the retry before its read completes could weaken the explicit retry across a failure or interrupted read.
- Recording only the current successful request avoids both changes and does not introduce another history cache.

The repository's existing owner/day/fingerprint/generation checks, failed-generation barrier and fresh rest-document read still decide whether complete history can be reused. Missing, mutated, stale or otherwise unconfirmed history continues to require the complete reads. Query shapes, authorization, historical/recurring normalization and transaction behavior are unchanged.

## Verification

- The exact new integration case fails on the base with 2 queries / 2 direct reads / 1,004 returned documents.
- The same case passes with 0 / 1 / 1 after the six-line hook delta.
- Five new regressions cover measured receipt reuse, repeated explicit retries, failed retry retention, a late retired retry versus a newer pending request, and inactive retry admission.
- Related hook, in-flight Firebase, Firebase repository and confirmed-history files: 61 tests pass.
- Final test-only correction replaced unsupported ES2022 `.at` with existing ES2020-compatible indexing and added a direct non-forced assertion. The two changed test files then pass all 34 cases; the remaining 27 test inputs and runtime are unchanged from the 61-case run.
- Fresh application typecheck passes on the final source. No full suite, browser, build or production access was run.

Retained failures are classified: the first command stopped before collection because the development URL helper could not enumerate network interfaces; the supported `DEV_LAN_HOST=127.0.0.1` override avoids that enumeration without starting a server. The first typecheck rejected `.at` in test code under the existing ES2020 target; no target or dependency was changed.

Evidence: `/workspace/shared/laplans-streak-retry-confirmation-evidence-20261018/`. Baseline, focused and typecheck logs remain separate. The installed shared toolchain is inventoried with the final input manifest. No native or production cost/performance claim is made.

## Ownership and remaining gates

The latest ownership check found no competing retry-scope implementation. #768 is already merged and remains unchanged. The separate commit-retirement correction is merged through #773 at `c683f741`; the #774 update retains both hook changes and all twelve added regressions.

Publication and the explicit integration of the two hook corrections are approved. Independent source review of the original retry candidate found no blocker and checked all five files, seven logs, focused/boundary inputs and installed toolchain hashes (receipt SHA-256 `d86f602fcaad8ab5a08409c82bbe86e2a72cfbcd4bc671e5d76ae2b95ce57bdf`). The exact local commit is bound separately in the evidence directory. No new cache architecture or same-Plan query narrowing is proposed.


## Approved latest-main integration (2026-10-18)

The ordinary #774 update retains published `f64b14cf64b3b3bd79fce8929c91144f6e2ecb43` as its first parent and main `627504546e37216ef3b839e0267c69ae499b7996` as its second parent. Its hook and two changed test files exactly match the previously reviewed combined snapshot `a923fb82`. Each test retains the original body followed by the complete retirement and retry additions, each once. All other main files are retained, apart from the retry handoff/README and retirement status text.

The earlier combined snapshot passed 72 directly related tests in five files, fresh application types and a production build. Those results are historical evidence on its `da9e90da` base. Current main includes #764/#770 package, lockfile, Vite and shared CSS changes; the new integration requires ordinary CI on that new toolchain. No previous pass is represented as a fresh run here. The publisher owns that CI, and QA owns the general streak native-result reconciliation. The separate native regressions do not directly prove Firebase race handling or production billed-read savings.

The commit-retirement boundary remains the application callback checks described in its handoff. Once an SDK transaction callback has staged its write and returned, later hook retirement does not guarantee cancellation of the SDK-enqueued commit, even before network transmission. Initial consent changes remain a separate PR and are not introduced by this update.
