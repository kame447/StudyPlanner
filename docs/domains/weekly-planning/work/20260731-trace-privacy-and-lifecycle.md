# 週間計画 trace privacy / lifecycle production rollout

Status: active / retention verified in production; v2 diagnostic masking in PR #925; production delete/audit E2E and operator deletion path pending
Priority: P1 operations
Updated: 2026-10-29
Tracking: Issue #45
Related: Issue #89 production trace recovery, Issue #164 storage design

## Implemented foundation

- versioned trace consent
- HMAC subject token / raw UID non-storage boundary
- redaction / expireAt
- restricted admin API / access audit
- account trace delete API
- frontend / Worker contract and bounded transport
- turn-level diagnostics
- HMAC epoch auto-derivation from the oldest primary key (#645)
- bounded Logs pagination, versioned entry decode, redacted Debug Bundle (product observability admin)

## 2026-10-29 retention / deletion / audit changes

Production findings (read-only, Firestore console, 2026-10-29):

- None of the three trace collections had a Firestore TTL policy.
- Creating one was refused with `403: Project study-planner-d1bc8 has billing disabled`. Firestore TTL needs billing, and enabling billing is the owner's decision. The owner chose a Worker-side sweeper instead.
- Every sampled `expireAt` in sessions, entries and audits is a Firestore Timestamp.
- Pre-2026-07-18 browser-written traces still exist: they carry the raw `userId` and no `traceSubjectToken`, and their `expireAt` (2026-08 to 2026-10-15) has already passed. They were not removed by hand.
- Server-authority sessions created on 2026-10-21 exist, so new trace saving works after the #645 recovery.

Changes:

- Retention: the existing Worker cron sweeper (`ProductObservabilityRetentionService`) now also deletes expired `weekly_planning_trace_sessions` / `weekly_planning_trace_entries` / `weekly_planning_trace_access_audit` documents. It runs in its own schedule phase at UTC minutes ending in 4, every 10 minutes (144 runs/day), at most 1 batch × 20 documents per collection per run.
  - The full-page query uses `endAt = now`, so billed reads are the expired documents only, not a 100-row page.
  - Timestamps are compared at nanosecond precision.
  - Each delete carries the `updateTime` it read as a precondition, so a session extended by a concurrent append is kept and the batch retries on a later run.
  - Only documents whose `expireAt` has passed are deleted. The first runs after deployment remove the expired legacy raw-`userId` traces. That is expiry, not manual deletion.
- Free-tier bound, from Firestore usage and COUNT aggregations (about 2 reads) on 2026-10-29: trace totals are sessions 69, entries 1,078, audit 271. Daily usage was 1,825 reads, 31 writes and 0 deletes against the 50k/20k/20k free quotas.
  - Trace retention worst case: 144 × (3 probe reads + 60 rows) = **9,072 reads/day** and **8,640 deletes/day**.
  - Idle cost: 432 reads/day.
  - The whole current trace corpus (1,418 docs) would take at most 24 runs (about 4 hours) to clear if it were all expired.
  - The pre-existing observability retention phase is unchanged. Its theoretical maximum (2 × 4 × 100 per 5 min, up to 230,400 deletes/day) is not bounded by this change. Actual observability deletes were 0 on 2026-10-29. That is a separate, pre-existing free-tier risk.
- Deletion: `/weekly-planning-trace/delete` now
  - derives HMAC subjects for every epoch since the primary root (`derivedCoverage: 'since-root'`), not only the 180-day derivation window. Append extends `expireAt` while keeping the original subject epoch, so a session can outlive that window;
  - also deletes legacy browser-written documents by the raw `userId` field;
  - writes a `delete_own_traces` access-audit record (pseudonymous actor token, 180-day `expireAt`) before deleting, matching the privacy policy's statement that viewing and deletion operations are recorded. If the audit write fails, nothing is deleted;
  - finds documents with `IN` queries (≤ 30 subject tokens per query, `__name__` only) and deletes each page with one bulk commit. A 44-entry, 1-session, 25-epoch delete uses 7 Firestore subrequests. The old per-document DELETE path exceeded the Worker subrequest limit at that size (independent review).
- Emulator E2E `tests/firestore/weeklyPlanningTraceLifecycle.emulator.test.ts` (run by `npm run test:firestore-rules`): consent → session/start → append → redaction and raw-UID absence in stored fields → 403 for non-readers with no audit write → audited Logs listing, entry page and redacted Debug Bundle → audited delete covering the current epoch, an epoch outside the retention window and the legacy `userId` schema, keeping another user's traces → the sweeper removes expired traces on real Firestore timestamps.

## 2026-10-29 production retention evidence (ProudNoether)

Worker `2c95328b` (tag `main-af6d6496`) was deployed at about 12:34 UTC. Firestore COUNT aggregations in the console query builder (`expireAt` ≤ / > `2026-10-29T14:50:19Z`, no document contents read):

| Collection | Before deploy (AzureGauss) | Expired at 14:50 | Expired after the 14:54 run | Unexpired (14:50 and after 14:54) |
| --- | --- | --- | --- | --- |
| sessions | 69 | 0 | 0 | 61 |
| entries | 1,078 | 78 | 58 | 740 / 740 |
| access audit | 271 | 0 | 0 | 271 |

- Entries: 1,078 − 818 = 260 removed = 13 runs (12:44 to 14:44 UTC) × 20, and the 14:54 run removed exactly 20 more. Unexpired entries and audit records did not change. The remaining 58 expired entries clear in 3 more runs.
- Sessions: all expired sessions are gone. 69 − 61 = 8 matches the expired legacy sessions, though a session created in the same window would make that count inexact.
- Run log and failures: `wrangler tail` (14:46 to 15:01 UTC) captured all 14 scheduled invocations with outcome `ok` and 0 exceptions. The 14:54 run logged `operation: 'trace_retention'` with 6 subrequests (1 OAuth + 5 Firestore; limit 45). The log line carries no deleted-document count, so the deletions above come from the Firestore counts.
- Free tier, Firebase usage for the last 24 h at 14:55 UTC: 7,782 reads, 448 writes, 489 deletes against 50k / 20k / 20k.

## 2026-10-29 v2 diagnostic masking (PR #925)

`turn_diagnostic` schema v2 strings are now masked before storage, and also when the admin entry page reads v2 entries stored before the fix. Masked: email, phone, URL query/hash, and credential-like runs (a 28+ character run with a 16+ character segment containing a digit). Kept: the envelope fields, UUID-based ids, `sha256:` / `fnv1a32:` digests, identifier labels and full text length. Matching is best effort, not a guarantee. Already-stored v2 documents are not rewritten. They are masked when read and expire within 180 days. The Debug Bundle already used the v1 redactor.

## Account-deletion request runbook (trace data, minimal)

Full account withdrawal is Issue #917. This covers only weekly-planning traces.

1. Identity: accept the request only as an in-app inquiry from the signed-in account itself, because the inquiry is bound to its Firebase UID. Do not act on a request that names another account or arrives by an unauthenticated channel. Reply through the inquiry thread.
2. Deletion: `/weekly-planning-trace/delete` deletes all of the signed-in user's traces across every epoch since the primary root, plus the legacy raw-`userId` documents. It writes a `delete_own_traces` audit record and is idempotent: a second call returns 0/0. It needs the user's own ID token. **No in-app button and no operator path for another UID exist.** Operators must not use an HMAC secret or impersonate the user to delete traces by hand.
3. Until #917 adds an in-app or operator path, record the request and its date, and tell the user that traces expire within 180 days of their last write. Do not claim immediate deletion.
4. Verification after deletion: confirm the `delete_own_traces` audit record (action and time only) and that a second delete returns 0/0.

## Remaining production work

- Independent Codex Sol audit of PR #925 has not been done. Both ORRERY child spawns were refused by the launcher (`child state belongs to another registration` / `canonical Codex registration metadata is missing, invalid, or does not match the child token`). The operator needs to run `agentstack-doctor`.
- Deploy PR #925 to the Worker (ACQUIRE/RELEASE on #305, keeping Jev and the other bindings), then read back.
- Production delete/audit E2E with a synthetic account (consent → append → admin Logs and Debug Bundle → delete → second delete 0/0 → audit present): **not performed.** Agent safety rules prohibit an agent from creating accounts or entering passwords on the production site, and the admin Logs need an authenticated admin session. The owner can run it by hand. Do not bulk-delete the shared test account, because it holds other traces. The emulator E2E covers the same flow.
- The operator path for deletion requests (runbook step 3) depends on #917.
- Privacy / legal review: **no professional legal review has been performed.** Only the engineering comparison below exists.

## Privacy notice vs stored fields (engineering check, not legal review)

| Policy statement (LegalPage) | Stored / enforced |
| --- | --- |
| アカウント番号を直接保存しない、30日ごとに変わる匿名化識別子 | Server writes: `traceSubjectToken` / `traceSubjectEpoch` (HMAC, 30-day epoch), no raw UID (emulator E2E asserts it). Legacy pre-07-18 browser writes with raw `userId` are expired and removed by the sweeper after deployment |
| メール・電話・URL識別情報・長い認証情報候補を保存前に除去 | v1 entries are redacted server-side. With PR #925, v2 `turn_diagnostic` strings are masked before storage, and on admin entry-page reads for pre-fix documents. The emulator E2E checks email, phone, URL query and credential in v1 and v2, in stored data, Logs and the Debug Bundle. This is best-effort pattern matching, not a guarantee |
| 会話本文などは原則180日で削除 | `expireAt` = write time + 180 days, enforced by the Worker sweeper (not Firestore TTL) |
| 閲覧は調査権限者に限る | `admins/{uid}.enabled && weeklyPlanningTraceReader`; Firestore Rules deny all client access |
| 閲覧や削除などの操作は記録 | Audit actions: `list_sessions`, `list_entries(_page)`, `create_debug_bundle`, `archive_session`, `delete_own_traces` |

## Ownership boundary

Issue #45 owns privacy, retention, restricted access, deletion and production governance.

Issue #89 separately owns the same-conversation empty-session / recovery verification. #89 が未完だからといって privacy task 全体を #89 の task として扱わない。

client-first storage / sync changes are coordinated with Issue #164 and must not create another trace authority.
