# Stable V5 conversation・Fact Graphをcloud sessionへ同期する

Status: active / local persistence complete, cloud repository not started
Priority: P2
Created: 2026-07-16
Updated: 2026-07-28
Tracking: Issue #47
Depends on: none
Blocks: `20260728-weekly-planning-personalization-rollout.md`

## 1. 現在地

同一browser profile内では、owner + week scopeのlocal envelopeへ次を保存・復元できる。

- conversation ID
- messages
- compatibility intake state
- Fact Graph V5
- preview candidates
- draft blocks
- PlanningState revision

未実装:

- 端末Aから端末Bへの復元
- cloud authoritative revision
- multi-client conflict resolution
- offline queue/reconciliation
- local envelopeの一度限りmigration
- cloud retention/account deletion
- server-side proposal/Graph repository

current-time boundaryはscheduler safetyの独立taskであり、cloud repository実装の技術的前提にはしない。

## 2. Session identity

```text
ownerId + planningWeekScope
→ active conversation session
```

session scopeの`weekStartDate`と、実際の配置対象であるplanning horizonは別fieldで保持する。

必要なmetadata:

- schema generation
- owner ID
- week scope
- conversation ID
- Fact Graph V5 revision
- PlanningState revision
- messages/preview/draft revision
- status: `active | completed | invalidated | abandoned`
- createdAt / updatedAt
- optimistic concurrency token
- migration source/version

永続化禁止:

- active Promise
- `pendingTurn`
- `pendingApproval`
- session-local proposal record
- raw credential/provider response
- browser-only lock object

## 3. Consistency contract

- cloudを共有正本とし、localStorageはoffline cacheまたはmigration sourceとする
- conversation、Graph、messages、preview、draftを同じrevision boundaryでcommitする
- stale revisionによる上書きを拒否する
- owner/week/conversation mismatchをfail closedにする
- offline writeはoperation ID付きでat-least-once再送可能にする
- conflictを黙ってlast-write-winsで消さない
- reset/invalidationをidempotent operationにする
- local UI stateはcloud一時障害で即時消失させない
- quality trace、approval ledger、personalization profileとはcollection/identity/retentionを分離する

## 4. Migration

- current local envelopeをpure decoderで読む
- migration markerをcloudへ原子的に保存
- 同じlocal payloadの再送で重複sessionを作らない
- cloudに新しいrevisionがある場合はlocalを上書き元にしない
- migration成功後もrollback期間中はlocal cacheを安全に読める
- raw conversationをAIへ再投入してFact Graphを再生成しない

## 5. Test matrix

- 端末A作成 → 端末B復元
- 同じ端末のreload
- 2tab同時更新
- 2端末同時更新
- offline編集 → reconnect
- stale revision retry
- resetと旧writeのrace
- owner切替
- week切替
- corrupted/unknown schema
- local migration再実行
- cloud save failure時のlocal continuity
- account deletion/retention

## 6. 完了条件

- [ ] cloud repository schemaとsecurity rulesを実装
- [ ] conversation/Graph/preview/draftをatomic revisionで保存
- [ ] 別端末から復元
- [ ] stale revisionとmulti-client conflictを明示処理
- [ ] offline cache/reconciliationを実装
- [ ] local envelope migrationをidempotentに実装
- [ ] owner/week/conversation mismatchを拒否
- [ ] reset/invalidationをcloud operationへ接続
- [ ] retention/account deletionを実装
- [ ] Emulatorでrulesとconcurrencyを検証
- [ ] focused/full/typecheck/build/diff checkがgreen
- [ ] 2tab・2端末の実環境確認を完了

## 7. 対象外

- personalization aggregate/score
- quality trace本文の保存
- approval operation ledgerの統合
- 全文検索UI
- raw conversationからのAI migration