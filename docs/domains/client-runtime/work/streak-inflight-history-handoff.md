# Share overlapping streak history confirmation

Status: locally verified candidate; integration and publication pending
Owner: Issue #542 read-load scope; standalone follow-up
Branch: `perf/streak-inflight-history-20261016`
Base: `9abc46038e7fb6d8dd0c26dabf31b8e251311473`

## Recovery checkpoint (2026-10-17)

The runtime, 255-line regression test and original handoff were recovered byte-for-byte after workspace loss. Historical checks below describe the original candidate and are not reused as new-environment proof. A fresh combined focused run on the recovered QA/rest/streak tree executed four files / 43 tests successfully, including all 19 in-flight cases and seven existing streak-repository cases. The real-hook fixture again returned two owner queries, two direct reads and 2,002 fixture documents. Fresh dependencies were installed from the unchanged base lockfile. The approved five-scope release owns full verification, native CI and deployment; those gates remain pending at this checkpoint.

## Boundary and preflight

At 2026-10-16 20:21–20:22 UTC, current remote main remained the base above. All open PRs, related closed streak PRs, remote branches and latest #542/#483/#437 checkpoints showed no active same-scope owner. #700 preload and #653 automatic rest were merged. The accepted Actual-save candidate `05d0a306` is being published by another owner and is not changed. The separate CPU candidate `072103b8` owns only rest-date calculation and its tests, not repository reads.

The previous audit measured one post-save complete confirmation as two full queries plus marker/rest document reads. Three alternatives are evaluated: retain this necessary server revalidation; preserve apparently unaffected slices across a local save; share only identical in-flight confirmations. Cross-mutation slice caching is rejected for this patch because it could hide remote schedule corrections that the existing post-save complete read would observe before automatic rest use. No date/history cutoff, new freshness window, auth change or persistent cache is allowed.

Selected candidate for reproduction: calls overlapping with the same owner, local day, receipt generation and exact input fingerprint can share an unsettled read. Forced refresh, intervening history changes, owner/date changes and rest-day mutation must retain their existing authority boundaries. Completed promises must not become an extra cache; failures remain retryable and cannot authorize spending. Ordinary single post-save confirmation keeps its full-history cost. No production billing, SDK transport or normal-save latency savings are presumed.

The real-hook reproduction and local verification are recorded below. Full-suite/combined release verification belongs to the integration owner.

## Implemented boundary

`firebaseStudyStreakRepository` retains at most one in-flight non-forced read. A second call joins only while the pending owner, local day, receipt generation, exact history fingerprint (including absence of a hint), and latest request sequence match. `refresh: true` never joins or registers a joinable read. Changed inputs or an intervening rest-day transaction retire sharing. The pending slot is cleared on settlement; a superseded request cannot clear its replacement.

Complete-history queries, normalization, migration/server metadata confirmation, generation/epoch checks and transaction authority are unchanged. The existing completed-history cache is unchanged. No history slice is preserved across a local mutation, and all historical/recurring rows remain in the owner-only queries.

## Reproduction and counts

The regression uses the real React hook, the real Firebase streak repository and the real confirmed-history receipt. Only the Firestore SDK is replaced by delayed deterministic fixtures. After startup confirmation, a synthetic successful mutation invalidates the receipt. While the next full read is pending, React receives new arrays with identical contents. This supported effect restart previously issued a second full read. The fixture contains 1,000 Actuals and 1,000 schedule rows, including a recurring event beginning in 2000. The old hook lifetime is retired; only the current lifetime accepts the result.

| Controlled overlapping confirmation | Base main | Candidate |
| --- | ---: | ---: |
| SDK full owner query calls | 4 | 2 |
| SDK marker/rest document calls | 4 | 2 |
| Returned fixture documents | 4,004 | 2,002 |

These are logical SDK invocation and successful fixture-response counts, not Firestore billed reads, network transport measurements or real-device latency. The frequency of equivalent production overlaps has not been measured. A normal single post-save confirmation still makes two full queries plus two direct document calls; this patch does not claim to solve its history-size growth. Cross-mutation caching was deliberately rejected pending a separate reconciliation design.

## Verification receipt

Base/main remained `9abc46038e7fb6d8dd0c26dabf31b8e251311473` on the final 2026-10-16 20:29 UTC remote read. Local source/test hashes:

- `src/repositories/firebaseStudyStreakRepository.ts`: `1410fb9badb90f5567b2f46f9302e7dc34ef5d6380f31cbff7e442e9eea0c1ee`
- `src/repositories/firebaseStudyStreakRepository.inflight.test.tsx`: `b8b13c6b880c617647c6c85514a74a7267c3574b741ceae7aa66ee9fc6d6ee55`

Checks on those inputs:

- Baseline reproduction: expected failure only on the duplicate-count assertion, after confirming the real hook reaches ready and all historical rows survive. Initial fixture `peek` assertion was corrected to inspect the returned normalized history rather than compare an unnormalized input fingerprint.
- Final focused run: 15 files, 110 tests passed, including 19 new cases. Coverage includes pending-only sharing, settled rest refresh, owner/day/Actual/Plan/major-event changes, forced refresh in both directions, absent hint, A→B→A, mutation invalidation, failure retry, stale cleanup, uncertain metadata, and rest-save crossing.
- Real-hook tests verify only the latest lifetime automatically spends once; mutation or changed-input abort while the transaction read is held causes zero writes.
- Fresh `npm run typecheck:app:full`: exit 0. An earlier test-only type failure (generic deferred inference and unsupported Array.at) was corrected; the runtime was unchanged.
- `DEV_LAN_HOST=127.0.0.1 npm run build`: exit 0, 6.84 seconds. Existing large-chunk warning remains.
- Independent review on the runtime hash above: no blocker. Four additional transaction-read interruptions (mutation, abort, forced refresh, owner switch) rejected before `transaction.set`; 4 executed cases passed, 19 original cases intentionally skipped in that independent run.
- `git diff --check`: clean.

Environment: Node 24.19.0, installed TypeScript 5.9.3, Vitest 3.2.7, Firebase 12.12.0, Vite 6.4.3, React 18.3.1; existing dependency installation reused by symlink. Local artifact logs are in `artifacts/streak-inflight/`. The handoff receipt records exact commit/tree and all changed-file hashes outside the repository.

## Remaining boundary / next action

This is a locally verified candidate, not a published change. No GitHub write, deployment, production experiment or main edit was performed. Existing Issue #542 is reused for scope; this branch is separate because no active same-scope branch/PR existed. No new Issue or PR and no branch deletion were performed. Keep this branch until the integration owner accepts or explicitly abandons it, then use the normal branch lifecycle.

The integration owner must verify combined content with fresh full app/Worker types, full suite, build and any applicable release gates. This worker did not run the full suite or a new Emulator test because SDK query shape, Rules and transaction body are unchanged; synthetic call counts do not establish real SDK transport or billing. No general cross-client atomic-history guarantee is added. There is no UI layout change. Ordinary post-save complete-history read cost remains a separate investigation, requiring a safe server reconciliation design rather than historical truncation.
