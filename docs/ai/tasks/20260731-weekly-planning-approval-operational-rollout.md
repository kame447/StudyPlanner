# 週間計画approval永続化をproduction運用へ展開する

Status: active / implementation verified, production operation pending
Priority: P1 operations
Requirement IDs: DA-PREVIEW-001
Created: 2026-07-18
Updated: 2026-07-31
Depends on: `closed/20260716-weekly-planning-approval-persistence-and-idempotency.md`

## 現在地

実装・自動検証済み:

- approval専用save boundary
- deterministic Plan ID
- server transaction idempotency
- operation/item ledger
- progress monotonicityとfailed item recovery
- owner/session/preview revision binding
- restored draft approval lifecycle
- local owner-bound ledgerとsave side-effect isolation

未完了はproduction Firestore設定、Emulator concurrency、2tab・2端末確認である。

## Production scope

- Firestore Rules deploy revision/日時の記録
- approval operation/item collection groupのTTL enable
- Emulator rules/transaction test
- 2tab・2端末相当の同時approval
- response loss、途中失敗、finalize失敗、reload、localStorage消去後retry
- retention orphan防止
- account deletion cascade

## 完了条件

- [ ] production Rules deploy記録を保存
- [ ] operation/item TTLをenable
- [ ] Emulator rules/transaction testsをCIへ追加
- [ ] 複数clientでduplicate Planが発生しない
- [ ] response loss/retryが同じPlanへ収束
- [ ] failed/missing/owner mismatchがfail closed
- [ ] account deletionとTTL orphan処理を確認
- [ ] focused/full/typecheck/build/diff checkがgreen
- [ ] production runbookを更新
- [ ] 実環境確認後だけoperationally deployedと記録

## 対象外

- approval domain再設計
- personalization profile
- quality trace rollout