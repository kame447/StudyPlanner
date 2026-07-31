# Stable V5 conversation・Fact Graphをcloud sessionへ同期する

Status: active / local persistence complete, cloud repository not started
Priority: P2
Created: 2026-07-16
Updated: 2026-07-31
Tracking: Issue #47
Depends on: none
Blocks: `20260731-weekly-planning-personalization-rollout.md`

## 現在地

同一browser profileではowner + week scopeのlocal envelopeへconversation ID、messages、compatibility state、Fact Graph V5、preview、draft、PlanningState revisionを保存・復元できる。

未実装:

- cloud authoritative revision
- 別端末復元
- 2tab・2端末競合処理
- offline queue/reconciliation
- local envelope migration
- cloud retention/account deletion
- server-side proposal/Graph repository

## Session identity

```text
ownerId + planningWeekScope
→ active conversation session
```

week scopeと実際のplanning horizonは別fieldとする。conversation、Graph、messages、preview、draftを同じrevision boundaryでcommitする。

## Consistency contract

- cloudを共有正本、localStorageをoffline cacheまたはmigration sourceとする
- stale revisionによる上書きを拒否する
- owner/week/conversation mismatchをfail closedにする
- operation ID付きat-least-once再送へ収束させる
- conflictをlast-write-winsで黙って消さない
- reset/invalidationをidempotent operationにする
- quality trace、approval ledger、personalization profileと保存責務を分離する
- machine pending questionとFact Graph revisionを同じsession revisionで保存する

## 完了条件

- [ ] cloud repository schemaとsecurity rulesを実装
- [ ] conversation/Graph/preview/draft/pending questionをatomic revisionで保存
- [ ] 別端末から復元
- [ ] stale revisionとmulti-client conflictを明示処理
- [ ] offline cache/reconciliationを実装
- [ ] local migrationをidempotentに実装
- [ ] reset/invalidationをcloud operationへ接続
- [ ] retention/account deletionを実装
- [ ] Emulatorでrules/concurrencyを検証
- [ ] focused/full/typecheck/build/diff checkがgreen
- [ ] 2tab・2端末の実環境確認

## 対象外

- personalization aggregate/score
- quality trace本文
- approval operation ledgerの統合
- raw conversationのAI再解釈migration