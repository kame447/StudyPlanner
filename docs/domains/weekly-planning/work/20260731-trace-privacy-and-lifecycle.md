# 週間計画 trace privacy / lifecycle production rollout

Status: active / retention, deletion and audit implemented; production rollout and verification pending
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

- Retention: the existing Worker cron sweeper (`ProductObservabilityRetentionService`) now also deletes expired `weekly_planning_trace_sessions` / `weekly_planning_trace_entries` / `weekly_planning_trace_access_audit` documents. It runs in its own schedule phase at UTC minutes ending in 4, every 10 minutes, at most 2 × 100 per collection per run. The phase is separate so a commit stays below Firestore's 500-write limit. The existing observability retention budget is unchanged. It deletes only documents whose `expireAt` has passed. The first run after deployment removes the expired legacy raw-`userId` traces. That is expiry, not manual deletion.
- Deletion: `/weekly-planning-trace/delete` now
  - derives HMAC subjects for every epoch since the primary root (`derivedCoverage: 'since-root'`), not only the 180-day derivation window. Append extends `expireAt` while keeping the original subject epoch, so a session can outlive that window;
  - also deletes legacy browser-written documents by the raw `userId` field;
  - writes a `delete_own_traces` access-audit record (pseudonymous actor token, 180-day `expireAt`) before deleting, matching the privacy policy's statement that viewing and deletion operations are recorded.
- Emulator E2E `tests/firestore/weeklyPlanningTraceLifecycle.emulator.test.ts` (run by `npm run test:firestore-rules`): consent → session/start → append → redaction and raw-UID absence in stored fields → 403 for non-readers with no audit write → audited Logs listing, entry page and redacted Debug Bundle → audited delete covering the current epoch, an epoch outside the retention window and the legacy `userId` schema, keeping another user's traces → the sweeper removes expired traces on real Firestore timestamps.

## Remaining production work

- Deploy the Worker carrying these changes (keep Jev and the other bindings; ACQUIRE/RELEASE on #305), then confirm that a `trace_retention` run removed the expired legacy traces and left unexpired ones.
- Production delete / audit verification with the live test account (consent → append → admin Logs and Debug Bundle → delete → second delete returns 0 → `delete_own_traces` audit present).
- Account-deletion runbook: `/delete` acts only for the signed-in user. There is no in-app button and no operator path for another UID, so an account-deletion request needs a decided procedure.
- Privacy / legal review record: no professional legal review has been performed. Only an engineering comparison of the policy text against stored fields exists (below).

## Privacy notice vs stored fields (engineering check, not legal review)

| Policy statement (LegalPage) | Stored / enforced |
| --- | --- |
| アカウント番号を直接保存しない、30日ごとに変わる匿名化識別子 | Server writes: `traceSubjectToken` / `traceSubjectEpoch` (HMAC, 30-day epoch), no raw UID (emulator E2E asserts it). Legacy pre-07-18 browser writes with raw `userId` are expired and removed by the sweeper after deployment |
| メール・電話・URL識別情報・長い認証情報候補を保存前に除去 | Server-side redaction before write; the E2E asserts the stored and exported email is absent |
| 会話本文などは原則180日で削除 | `expireAt` = write time + 180 days, enforced by the Worker sweeper (not Firestore TTL) |
| 閲覧は調査権限者に限る | `admins/{uid}.enabled && weeklyPlanningTraceReader`; Firestore Rules deny all client access |
| 閲覧や削除などの操作は記録 | Audit actions: `list_sessions`, `list_entries(_page)`, `create_debug_bundle`, `archive_session`, `delete_own_traces` |

## Ownership boundary

Issue #45 owns privacy, retention, restricted access, deletion and production governance.

Issue #89 separately owns the same-conversation empty-session / recovery verification. #89 が未完だからといって privacy task 全体を #89 の task として扱わない。

client-first storage / sync changes are coordinated with Issue #164 and must not create another trace authority.
