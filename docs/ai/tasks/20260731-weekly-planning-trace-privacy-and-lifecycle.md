# 週間計画 trace privacy / lifecycle production rollout

Status: active / core implemented, production operations pending
Priority: P1 operations
Updated: 2026-08-22
Tracking: Issue #45
Related: Issue #89 production trace recovery

## Implemented foundation

- versioned trace consent
- HMAC subject token / raw UID non-storage boundary
- redaction / expireAt
- restricted admin API / access audit
- account trace delete API
- frontend / Worker contract and bounded transport
- turn-level diagnostics

## Remaining production work

- production HMAC secret ring / rotation
- Worker / Firestore Rules deployed revision evidence
- session / entry TTL
- account deletion cascade verification
- restricted reader / audit verification
- privacy notice vs persisted fields review
- pagination / stable cursor / bounded query / index
- schema-version decoder / corrupt-entry handling
- privacy / legal review record
- browser consent / append / export / archive / delete verification

## Ownership boundary

Issue #45 owns privacy, retention, restricted access, deletion and production governance.

Issue #89 separately owns the same-conversation empty-session / recovery verification. #89 が未完だからといって privacy task 全体を #89 の task として扱わない。

client-first storage / sync changes are coordinated with Issue #164 and must not create another trace authority.
