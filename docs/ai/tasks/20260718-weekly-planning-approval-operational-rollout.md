# 週間計画approval永続化を本番運用へ展開する

Status: planned
Priority: P1
Requirement IDs: DA-PREVIEW-001
Updated: 2026-07-18
Depends on: `closed/20260716-weekly-planning-approval-persistence-and-idempotency.md`

## 1. 目的

PR #60、#62、#63で実装・自動検証したserver-side idempotencyを、本番Firestore設定と実環境検証まで完了させる。

## 2. Scope

- `firestore.rules`を本番projectへdeployする。
- 次のcollection groupで`expiresAt` TTL policyを有効化する。
  - `weekly_planning_approval_operations`
  - `weekly_planning_approval_items`
- Firestore Emulatorでowner、identity、進捗単調性、同時transaction、復旧、fail-closed rulesを検証する。
- 2tab・2端末相当で同じapproval itemを同時保存し、Planが一件だけになることを確認する。
- transaction途中失敗、finalize失敗、reload、storage消去後の再試行を確認する。
- operation/item双方がTTL対象となり、親だけ削除されてitemが残らないことを確認する。

## 3. Acceptance criteria

- 本番rules deployのproject、revision、日時が記録されている。
- 両collection groupのTTL policyがenabledである。
- Emulator rules testとtransaction integration testがCIでgreenである。
- multi-client実環境確認でduplicate Planが発生しない。
- failed item、missing Plan、ownership mismatchがfail closedとなる。
- operationally deployedと記載するのは上記完了後だけとする。

## 4. Out of scope

- approval domainの再設計
- Plan provenance schema変更
- local ledgerの削除
- personalization profile
- trace privacy rollout