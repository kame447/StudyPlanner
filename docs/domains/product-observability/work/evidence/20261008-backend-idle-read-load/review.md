# Retention read-load safety review

Date: 2026-10-08 UTC. Read-only source review at StudyPlanner HEAD `713852e411f3c69621c9dbd96c1e50f5c1579c34`. The publishing worktree was clean before and after this review. No production calls, secrets, deployments, actual deletion, or implementation changes were performed.

## Recommendation

Compare an **ordered limit-1 gate followed by the unchanged fresh limit-100 query** as the smallest behavior-preserving read optimization. Do not immediately replace the query with `where(expireAt <= now)`.

1. Capture the existing `nowIso` once per batch.
2. Query each existing allowlisted collection with the same ordering, filters, and direction, but limit 1.
3. If the existing `expiredPrefix` predicate accepts that first row, issue the normal full-page query again. Derive every delete and `hasMore` only from this fresh full-page response using the unchanged predicate. A preflight row must never itself become a deletion instruction.
4. Keep the existing four-collection allowlist, page-size clamp, commit boundary, failure propagation, and two-batch schedule cap. Do not add persistent cursors, schema migration, alternate deletion policies, production work, or TTL configuration.

With an unchanged snapshot this is equivalent for every row ordering, not only valid sorted timestamps: an empty expired prefix is determined solely by the first row, and a nonempty prefix triggers the original full scan. The same predicate was extracted unchanged and transpiled for an offline finite comparison: 16,105 arrays of lengths 0–4 over 11 expiry-value cases all produced identical deletion IDs. This checks the reasoning; it does not validate a candidate implementation or Firestore integration.

## Source and measured baseline

- `productObservabilityRetention.ts:8–15,33–42,52–74`: four allowlisted collections, 100-document cap each, local lexical prefix decision, one bulk commit. Null or any non-string at the head stops the collection. Any string lexically <= cutoff passes, including malformed strings.
- `firestoreServiceAccountClient.ts:819–848`: ordered query currently supports string equality filters only; ordering is `expireAt ASC, __name__ ASC` for retention. No cursor is passed by retention.
- `traceWorker.ts:75–94,180–192`: retention runs one phase every five minutes and at most two batches per invocation.
- `workerSubrequestBudget.ts:1–2`: current warning threshold 40 and hard cap 45.
- Independent existing characterization: `<MEASUREMENT_OUTPUT>/results/summary.tsv` and `report.json`. All retained, at least 100 docs per collection: HTTP 5, query 4, returned docs 400, deletes 0; repeat has identical document keys. Expired backlog: HTTP 11, query 8, returned docs/deletes 800.

Predicted gate comparison, still requiring candidate implementation tests: retained state becomes 4 returned documents (or four empty queries) and remains HTTP 5. Full expired backlog becomes 808 returned documents, at most HTTP 19, and the same 800 deletes across two batches. These are request/document-return counts, not a verified invoice or complete billed-read count.

## Alternatives considered

### A. Ordered limit-1 gate: recommended bounded first step

Preserves existing query shape, type handling, malformed-prefix blocking, deletion policy, and commit semantics. It costs one extra read/query for a collection whose head is expired. Existing indexes suffice because only limit changes. It deliberately does not repair existing retention correctness issues.

### B. Typed expiry range: potential later change

The correct wire predicate is `expireAt LESS_THAN_OR_EQUAL {timestampValue: cutoff}`. `expireAt` is encoded as a timestamp even though decoded rows expose strings (`firestoreServiceAccountClient.ts:139,186–189,218`). A string-value cutoff does not match timestamp fields; the official SDK's field matcher enforces matching backend type order for ordinary range filters.

This is not universally equivalent to the current ordered-prefix scan:

- A null, boolean, or numeric head currently blocks later expired timestamps; a typed timestamp filter excludes that head and enables deletion behind it.
- Missing expiry is already excluded by existing `orderBy`; a range will not discover or repair it.
- A legacy string expiry, even a valid-looking ISO string, is excluded by the timestamp filter. Conversely, some malformed strings are currently eligible under the lexical guard.
- Mixed timestamp/string ordering is type-first. A future timestamp can precede an expired-looking string and stop the current prefix. Do not model this by sorting all values as strings.
- Merely adding a timestamp filter while preserving the lexical guard leaves the precision issue below. Removing or replacing the guard changes the deletion decision and needs its own safety contract.

A single-field timestamp range with same-direction name tie-breaking is expected to use the existing automatic ascending index; repository `firestore.indexes.json` has no field exemptions. This is a query-shape inference, not validation of deployed configuration. Do not add environment/actor filters, collection-group scope, or different ordering without reassessing indexes and authorization.

### C. Smaller batches, slower schedule, or managed TTL: not the minimal fix

Permanently lowering page size reduces deletion throughput; slowing cadence changes retention delay. Managed TTL requires an operational policy/configuration change and has different deletion behavior and billing. None is needed for the gate and none is authorized by this review.

## Concurrency, progress, and deletion safety

Required race tests after a positive preflight:

- The head changes to a future expiry: full query/predicate yields no deletion of that head.
- The head disappears: do not delete from stale preflight data; use only rows returned by the fresh full query.
- A new earlier expired row appears: it is eligible only if present and accepted in the full query.
- A new null/non-string head appears: preserve the current stop behavior; do not reuse the stale positive decision.

A negative preflight followed by a concurrent expired insertion can defer that item until the next invocation. There is no durable progress checkpoint to incorrectly advance. This is not snapshot-atomic equivalence across concurrent writes; the existing scan also sees only a point-in-time result.

Retain deletion-driven pagination: successful delete removes the current prefix and the next batch starts again at the head. Do not introduce a cursor. The generic ordered cursor currently serializes its value as `stringValue`, unsuitable for timestamp pagination without a separate typed-cursor change. Exact-page expiry must keep the conservative `hasMore=true`; an extra empty pass is acceptable. Any full-query/commit failure must preserve retryability, not claim progress.

The existing delete request has no update-time precondition (`firestoreServiceAccountClient.ts:535–537`). Therefore an expiry refresh between the final full read and commit remains an existing race; preflight alone does not fix or worsen the source-of-truth boundary. Do not describe this optimization as a concurrency-safety repair.

Deletion remains the scheduled service-account/IAM responsibility. No browser, client Rules, admin endpoint, collection allowlist, user-data scope, credential, or permission expansion is needed. Server/REST service-account access is not protected by the client Rules. Production deletions or policy changes remain outside this task.

## Separate unresolved timestamp-comparison issue

Actual guard: stop if `typeof expireAt !== 'string' || expireAt > nowIso`. Decode returns REST `timestampValue` unchanged as a string. REST timestamp formatting permits different fractional precision.

With cutoff `2026-08-28T12:00:00.500Z`, direct execution of the existing comparison demonstrates:

- `2026-08-28T12:00:00Z`: already expired, but lexical comparison stops; deletion is delayed.
- `2026-08-28T12:00:00.500001Z`: one microsecond in the future, but lexical comparison accepts deletion.
- Empty string and `0-not-a-date`: accepted by the existing guard if encountered before a blocker.

Reachability assessment:

- All current normal writers for these four collections calculate expiry with JavaScript `Date(...).toISOString()`, producing millisecond precision. Raw events: `productObservabilityStore.ts:275,300,331,353`; actor-day/daily rollup: `productObservabilityReadModelProjection.ts:31–35,191,354,460,475`; active windows: `productObservabilityActiveUserSnapshot.ts:138–142,554`. Rollup/snapshot clocks also originate in `Date.toISOString()`.
- Shared-client history at `bb6da617` already encodes valid expiry as `timestampValue`; no evidence from this history establishes a normal legacy string-encoding period.
- A whole-second expiry is reachable through normal writers, and the API's valid zero-fraction representation can trigger delayed cleanup within the same second, potentially until the next five-minute run. This is a reachable formatting correctness risk, not evidence of observed production delay.
- Fractional-microsecond future expiry cannot be produced by the inspected normal writer paths. It is a valid Firestore value and survives decoding, but its production presence would require another/legacy writer or preexisting data not established here. Classify as an unresolved defensive deletion-safety edge, not confirmed production premature deletion.
- Naively switching to `Date.parse` also truncates fractional microseconds and cannot alone prove absence of early deletion. A future fix should define timestamp precision/type semantics and use exact normalization/comparison or a correctly typed backend filter plus appropriate local validation.

The read optimization must not silently change this predicate. Record the issue separately and test before any semantic fix.

## Candidate acceptance tests

1. All retained 0/1/30/100/1000 per collection; repeated idle runs. Gate query limit exactly 1; no full query or delete-commit HTTP call when negative (the existing empty `commitWrites([])` method call may remain); no repeated 400-doc reads.
2. Mixed expired/retained pages, duplicate expiry ties, exactly page-size expired, >page-size backlog, and two scheduled batches; identical deletion set/count and `hasMore` to baseline for frozen data.
3. Missing/null/boolean/number, legacy string, malformed string, REST zero/3/6-digit timestamp representations; preserve baseline behavior and separately label known predicate anomalies.
4. The four preflight/full-read races above; all deletes must be traceable to the second response. Keep one fixed cutoff.
5. Preflight failure, full query failure, and bulk commit failure; no partial progress report, no skipped retryable prefix.
6. Wire-format and request-budget assertions through the real scheduled worker and REST client with no network fallback. Gate worst-case 19 HTTP requests must stay below current hard cap 45.
7. No collection/IAM/Rules/index/TTL changes. No production execution in these tests.

## Official sources

- Missing order field is excluded: https://firebase.google.com/docs/firestore/query-data/order-limit-data
- Type ordering: https://firebase.google.com/docs/firestore/manage-data/data-types
- Official Firebase filter matcher requires matching type order: https://github.com/firebase/firebase-js-sdk/blob/main/packages/firestore/src/core/filter.ts#L131-L146
- REST timestamp representation and microsecond storage precision: https://docs.cloud.google.com/firestore/docs/reference/rest/v1/Value
- Automatic indexes and default name tie-break: https://firebase.google.com/docs/firestore/query-data/index-overview
- Query minimum charge and index-entry billing: https://firebase.google.com/docs/firestore/pricing
- Service-account/REST IAM versus Rules boundary: https://firebase.google.com/docs/firestore/security/rules-conditions

Billing caution: four empty queries still incur minimum reads; explicit `__name__` ordering and range-field classification can affect index-entry charges. No Query Explain or billing export was accessed. Do not present document-return reductions as exact total-charge reductions.
