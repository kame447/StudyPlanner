# 週間計画approval永続化をproduction運用へ展開する

Status: active / implementation verified, production operation pending
Priority: P1 operations
Requirement IDs: DA-PREVIEW-001
Updated: 2026-07-28
Depends on: `closed/20260716-weekly-planning-approval-persistence-and-idempotency.md`

## 1. 現在地

PR #60、#62、#63、#65で次を実装・自動検証済み。

- approval専用save boundary
- deterministic Plan ID
- server transaction idempotency
- operation/item ledger
- progress monotonicity
- failed item recovery
- owner/session/preview revision binding
- restored draft approval lifecycle
- local owner-bound ledger
- save side effect isolation

未完了はproduction Firestore設定とmulti-client実環境検証である。module test成功をoperational deploymentへ読み替えない。

## 2. Production scope

- `firestore.rules`を対象projectへdeployしrevision/日時を記録
- TTL policyを次のcollection groupでenable
  - `weekly_planning_approval_operations`
  - `weekly_planning_approval_items`
- Firestore Emulator rules test
- transaction concurrency/integration test
- 2tab・2端末相当の同時approval
- transaction途中失敗、response loss、finalize失敗、reload、localStorage消去後retry
- operationだけTTL削除されitemが残る、または逆のorphanを防ぐretention contract
- account deletion cascade

## 3. Security・consistency contract

- owner以外のoperation/item read/writeを拒否
- preview/session/revision mismatchをfail closed
- operation progressを後退させない
- same item retryは同じdeterministic Plan IDへ収束
- repositoryが返した実Plan IDをledgerへ記録
- client ledgerをserver authorityの代替にしない
- failed itemをsuccessとしてfinalizeしない
- missing Planまたはidentity mismatchを自動修復名目で別Planへ付け替えない

## 4. Test matrix

- same item simultaneous save
- different items same operation
- same item different tabs/devices
- response loss after Plan commit
- operation update failure
- item finalize failure
- reload/local cache loss
- owner switch
- stale preview
- pending assumption
- Rules deny
- TTL and orphan cleanup
- account deletion

## 5. 完了条件

- [ ] production Rules deploy記録を保存
- [ ] operation/item TTLをenable
- [ ] Emulator rules/transaction testsをCIへ追加
- [ ] 2tab・2端末でduplicate Planが発生しない
- [ ] response loss/retryが同じPlanへ収束
- [ ] failed/missing/owner mismatchがfail closed
- [ ] account deletionとTTL orphan処理を確認
- [ ] focused/full/typecheck/build/diff checkがgreen
- [ ] production runbookを更新
- [ ] 実環境確認後だけ`operationally deployed`と記録

## 6. 対象外

- approval domain再設計
- Plan provenance schemaの全面変更
- personalization profile
- quality trace rollout
- local ledger即時削除