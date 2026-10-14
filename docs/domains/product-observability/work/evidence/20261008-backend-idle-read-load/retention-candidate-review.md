# Independent retention candidate review

Reviewed 2026-10-08 UTC. No blocking regression found in the actual limit-1 gate implementation. This conclusion is restricted to the reviewed content and local source/mock evidence. Production deletion behavior and billing are unverified.

- Worktree: `<BACKEND_WORKTREE>`
- Base HEAD: `22847120386987329e2f034d6062d59694ef1180`
- Runtime: `workers/ai-proxy/src/productObservabilityRetention.ts`
- Runtime SHA-256: `ca129e6030948bfe213760f9eaa8d4410e6687b61fef293b0d95b657897fb8e5`
- Diff: eight added lines, consisting of a one-row query, reuse of the unchanged expiry predicate as a gate, and an explanatory comment. Original full-page read and all deletion/commit/progress code remain unchanged.

## Independent execution evidence

`audit-retention-candidate.mjs` bundles both HEAD's original service and the actual dirty candidate with the real REST client. All HTTP is intercepted. Synthetic datasets are sorted by Firestore type ordering; absent expiry fields are excluded as required by the existing order query. Timestamp wire values are real `timestampValue` objects, not strings disguised as Firestore timestamps.

- 33 baseline/candidate comparisons: 11 fixture shapes × page sizes 1/2/100. Fixtures include empty, 101 retained, 201 equal-expiry expired, mixed expired/retained, null/numeric blockers, missing expiry, legacy strings, malformed strings, zero-fraction timestamps, and fractional microseconds. Compared deletion IDs, returned deletion counts, and `hasMore` through repeated invocations (bounded at ten invocations for the smallest page sizes). All matched.
- Four positive-gate races: gate becomes retained; gate disappears; a new null blocker arrives; another expired document arrives. Deletion uses only the fresh full response in every case. Retained, disappeared, and blocked heads produce zero event deletions.
- Three injected failures: preflight query 503, full query 503, commit 503. Each throws, records zero synthetic deletions, and leaves all source fixture documents present.
- Query assertions: same four collections, `expireAt ASC` and `__name__ ASC`, no filter or cursor, bounded limit 1–100. Cutoff clock called once per batch. Delete writes contain only the existing allowlisted collection paths.

All assertions passed. Reproduction command: `node <REVIEW_OUTPUT>/audit-retention-candidate.mjs <BACKEND_WORKTREE>`. Output: `retention-candidate.log` in this directory. No production requests, credentials, repository writes, or real deletion occurred.

## Owner evidence checked

- `<MEASUREMENT_OUTPUT>/backend-green.log`: 56 tests / 6 files passed, including 14 retention tests, 16 snapshot tests, scheduled boundary, revision clearing, event-store retention, and budget tests.
- `<MEASUREMENT_OUTPUT>/combined-candidate/summary.tsv` and `report.json`: retained 100 documents × four collections now returns 4 documents instead of 400, with 5 HTTP requests unchanged; repeated idle case is also 4. Two full expired batches: 19 HTTP requests, 16 queries, 808 returned documents, 800 deletes, commit write counts `[400,400]`. This remains below the existing 45-request application ceiling.

## Scope and remaining work

No new indexes, predicate type assumptions, persistent cursors, collection scope, IAM/Rules, retention periods, TTL, or production changes are introduced. Failure retry and deletion-driven progress retain the existing behavior. The original post-read/pre-commit refresh race remains; this is not a new transactional-delete guarantee.

The existing lexical expiry comparison is deliberately unchanged. The separate precision/malformed-value caveats and current-writer reachability assessment are in `review.md`; do not represent the read optimization as repairing them. Keep this as an explicit unresolved retention-semantic issue with no production incidence asserted.

The integration owner still needs final applicable verification on combined exact content before readiness/publication. This reviewer did not duplicate the full suite, create branches/Issues/PRs, or publish anything. Snapshot review is separately recorded in `snapshot-review.md` with its own runtime hash and independent race checks.
