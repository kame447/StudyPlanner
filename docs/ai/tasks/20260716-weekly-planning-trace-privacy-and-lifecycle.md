# 週間計画traceのproduction privacy・lifecycle・scalabilityを完了する

Status: active / core implemented, production operations pending
Priority: P1 operations
Requirement IDs: P7-TRACE-001
Updated: 2026-07-28

Absorbs:
- `superseded/20260716-weekly-planning-trace-scalability-and-schema-migration.md`
- post-merge verification from `closed/20260727-weekly-planning-trace-empty-session-recovery.md`

## 1. 実装・自動検証済み

- login後のversion付きtrace利用同意
- server-side HMAC subject token
- 30日epoch rotation
- raw Firebase UIDをtrace documentへ保存しない境界
- email、phone、URL query、credential候補のredaction
- session/entryの`expireAt`
- server-authoritative session/conversation/entry ID
- browserからのFirestore直接read/write拒否
- restricted admin list/entries/export/archive
- access audit
- account trace deletion API
- development default / production explicit enable gate
- frontend/Worker共通event catalogとtransport limit
- Stable V5 full debug chunkのprivacy-safe encoding
- append batchingとsession identity continuity
- empty-session recoveryのfocused 46 tests、trace full 79 tests、typecheck、typecheck:build、build、diff check成功

実装済みであっても、Firestore TTL policy、production secret、Worker/Rules deploy、実browser、削除運用が未確認のためoperationally deployedではない。

## 2. Production operation残件

### Secrets・deploy

- production HMAC secret ringをsecret managerへ登録
- rotation手順と旧epoch削除手順
- WorkerとFirestore Rulesの対象project/revisionを記録
- deploy前後のpolicy version整合
- `VITE_WEEKLY_PLANNING_TRACE_ENABLED=true`は全gate完了後だけ設定

### Retention・deletion

- session/entry collection groupで180日TTLを実際にenable
- account deletion時に保持epoch tokenを解決しcascade delete
- primary storage 30日以内、backup最大90日の削除運用
- durable unsent queueが導入された場合の同意撤回/削除境界
- export済みfixtureを元traceへ再linkできない形へ変換

### Access・privacy

- non-reader adminの本文read拒否
- reader access/export/archive/delete audit
- privacy noticeと実保存fieldの一致
- legal/privacy review: 未成年者、要配慮情報、国外利用、委託先
- full debug traceにraw credential/provider secretを保存しない回帰

### Issue #89 post-merge verification

main merge/deploy後、同じlogical conversationへ実入力し、管理者viewerとJSON exportで次を確認する。

```text
session件数 = 1
turnCount > 0
entryCount > 0
stableV5DebugStagesを再構成可能
reload/retry後もsession件数が増えない
標準未export一覧へhistorical empty artifactを表示しない
```

- 上記確認前にIssue #89をcloseしない
- historical empty documentsを自動mergeまたは自動deleteしない
- 実環境で再発した場合は本taskを完了扱いにせず、同じIssue #89で継続する

## 3. Scalability・schema compatibility

現在のadmin listはbounded limitを持つが、stable pagination cursorとload-more contractは未実装である。

実装対象:

- session list cursor pagination
- entry timeline pagination
- stable ordering key
- query cost/page size
- composite indexとsingle-field exemption
- archive/aggregate collectionの条件
- session summary filter
- schemaVersion別decoder
- unknown event/version/corrupt entryのsafe representation
- export format versionとmigration policy
- destructive rewriteよりreader decoder追加を優先

## 4. Test matrix

- consent前にtrace作成なし
- 同一policy versionで再同意なし
- epoch rotation
- direct Firestore read/write拒否
- reader/non-reader admin
- TTL対象field type
- account delete cascade
- export redaction
- 500件超session pagination
- 100,000 entry相当のbounded timeline
- stable cursor ordering
- old/unknown schema decoder
- corrupt entryの部分表示
- archive後の新規activity
- production full debug append/export
- same conversationのempty/duplicate session非再発

## 5. 完了条件

- [ ] production secret/rotationを設定
- [ ] WorkerとRulesを本番へdeployしrevisionを記録
- [ ] TTL policyをsession/entryでenable
- [ ] account deletion cascadeを実環境またはEmulatorで確認
- [ ] restricted readとauditを確認
- [ ] paginationとbounded queryを実装
- [ ] index/runbookを文書化
- [ ] versioned decoderとunknown schema handlingを実装
- [ ] privacy/legal review recordを保存
- [ ] focused/full/typecheck/typecheck:build/build/diff checkがgreen
- [ ] 実browserでconsent、append、admin export、archive、deleteを確認
- [ ] main deploy後にIssue #89のsame-conversation verificationを完了
- [ ] production enable後にempty/duplicate sessionが再発しないことを確認

## 6. 対象外

- conversation cloud session repository
- personalization profile aggregation
- approval ledger運用
- client traceをsecurity監査または課金の正本にすること
- historical empty sessionの自動merge