# 週間計画approvalの永続idempotencyを設計・実装する

Status: planned
Priority: P1
Requirement IDs: DA-PREVIEW-001
Updated: 2026-07-18
Depends on: approval validation session binding、save side-effect isolation

## 1. 背景

approval operation ledgerはlocalStorageにあり、duplicate検索は各tabが保持する`plans`配列とmemo markerに依存している。この境界ではmulti-tab、別端末、storage消去、途中crashに対するexact-once保存を保証できない。

2026-07-18監査で次を確認した。

- operationは全item処理後に一括でlocalStorageへ書かれる。途中crashでは保存済みplanとledgerが分離する。
- `plans`は一括loadされたsnapshotであり、別tabの直近保存を反映しない。
- dedupeはユーザー編集可能な`[weekly-source:...]` memo文字列へ依存する。
- `Plan`/`PlanDraft`には`sourceType`と`sourceId`があるが、`PlanSourceType`は`manual | todo | timetable`だけで、週間計画用source typeは未定義である。
- 週間変換は`sourceType: 'manual'`、`sourceId: null`を設定する。
- ledgerの`savedPlanId`は実Plan IDではなく擬似IDである。

## 2. 目的

同一approval itemの保存をserver-sideの一意な境界でclaimし、同じ承認を複数tab・複数端末・retry・途中crashから実行してもPlanを一件だけ作成する。保存済みitemの進捗と実Plan IDをdurableに記録する。

保証対象は同一approval identityのreplayである。reload後に独立再計算された別previewを意味的に同一とみなすdedupeは、stable provenance keyを別途確定しない限り本taskのexact-once保証へ含めない。

## 3. 計画書との対応

- product spec: `docs/weekly-planning/weekly-planning-spec.md`の明示承認と重複防止
- architecture: `docs/architecture/weekly-planning-dialogue-architecture-v4.md`のapproval/save boundary
- roadmap: `docs/ai/strategy/weekly-planning-roadmap.md` §3
- test contract / Requirement ID: DA-PREVIEW-001
- related issue: #51

## 4. Entry conditions

- `20260718-weekly-planning-approval-validation-session-binding.md`を完了し、approval identityに実conversationIdを使えること。
- `20260718-weekly-planning-approval-save-side-effect-isolation.md`を完了し、保存関数が永続`Plan.id`を返すこと。
- Firestore transactionまたはdeterministic document IDで、claimとPlan writeをどこまで原子的に扱えるか確認する。
- legacy exam previewとbehavior-aware previewのoperation identityを列挙する。

## 5. 対象ファイル

- 変更候補:
  - approval operation repository interfaceとFirestore implementation
  - `weeklyPlanningApproval.ts`
  - `weeklyPlanningApprovalApplication.ts`
  - `weeklyPlanningApprovalTypes.ts`
  - `weeklyPlanningApprovalLedgerStorage.ts`
  - `types/domain.ts`の`PlanSourceType`
  - `weeklyPlanningTransforms.ts`
  - planner repositoryのPlan serialize/deserializeとquery
  - Firestore rule/index設定が必要な場合は対応file
- 新規:
  - server-side approval operation repository
  - transaction/idempotency integration test
- テスト: unit、repository integration、multi-client simulation

## 6. 現在の処理経路

```text
approval application
→ localStorage operationを検索
→ in-memory plansのmemo markerを検索
→ savePlanDraft
→ 全item完了後にlocalStorage ledgerを一括保存
```

失敗窓:

```text
Plan write成功
→ tab crash
→ ledger未更新
→ 別tab/別端末/再計算で保存済み判定できない
```

## 7. 確認済みの事実

- 現行`sourceDraftBlockId`は同一operation retryでは安定する。
- 再計算で新しいblock IDが生成される場合、旧block IDをkeyにしたclaimだけでは意味的重複を防げない。
- memo markerは表示・編集対象なのでauthoritative keyにできない。
- Plan source fieldを利用するには`PlanSourceType`、storage/repository schema、migrationを同時に更新する必要がある。
- localStorage ledgerはserver truthではなくcache/UX補助へ降格できる。

## 8. 未確認事項

- Firestore transaction内でapproval claimとPlan documentを同時にwriteする最小repository設計。
- deterministic Plan document IDを週間計画itemへ採用した場合の既存ID生成・編集経路への影響。
- server operation retention期間とaccount deletion時のcascade delete。
- 独立再計算間のsemantic dedupeをproduct要件に含めるか。

## 9. 問題点

- local stateとmemo検索は分散実行時の一意性を保証しない。
- operation progressとPlan writeが別境界で、一方だけ成功するcrash windowがある。
- source provenanceが型・repository schemaへ反映されていない。

## 10. 修正方針

- server-side approval operationを`userId + approvalOperationId`で一意に保存し、itemを`sourceDraftBlockId`で管理する。
- 同一itemのclaim、Plan write、savedPlanId更新を可能な限り単一transaction/batchへまとめる。原子的にできない場合は状態機械とrecovery queryを明記する。
- item処理開始前にserver claimを取得し、既にsavedなら実Plan IDを返して`skipped_duplicate`とする。
- item完了ごとにserver progressを更新し、次itemへ進む前にdurableであることを保証する。
- localStorage ledgerはserver operationのcacheとoffline表示補助へ限定し、authoritative duplicate判定に使わない。
- `PlanSourceType`へ週間計画由来の値を追加し、`sourceId`へserver item identityまたは確定したstable provenance IDを保存する。
- memo markerはmigration期間のdiagnostic/legacy fallbackに限定し、新規保存の一意性根拠にしない。
- 既存Planのsource field migration、decoder互換、query indexを定義する。
- transaction conflict、network failure、repository validation failureを区別し、retry可能性を型で表す。

## 11. 触らない範囲

- AIがapprovalを自動判断すること
- preview生成条件とscheduler再計算
- conversation traceをidempotency truthとして使うこと
- stable provenance未決定のまま、別previewの内容一致だけで自動dedupeすること
- 既存手動PlanのID変更

## 12. 受け入れ条件

- staleまたはpending-assumption previewではserver claimを作らない。
- 同一approval itemを2tab・2端末から同時承認してもPlan documentは一件だけ作られる。
- Plan write直後にclientが停止しても、再試行は保存済みitemと実Plan IDをserverから復元する。
- partial failure後は未保存itemだけをretryする。
- localStorage消去後も同一operation/itemの重複保存を防ぐ。
- 別tabの古い`plans` snapshotへ依存しない。
- 新規週間Planのdedupeはmemo編集で壊れない。
- `savedPlanId`が実際の永続Plan IDと一致する。
- transaction conflictと保存validation failureを区別して表示・retryできる。
- legacy exam previewと既存local ledgerの互換/migration方針がtestで固定される。
- 別preview再計算間のsemantic dedupeを保証しない場合、その制限がproduct/UX文書へ明記される。

## 13. テスト観点

- unit: operation/item state machine、claim result、error category、source field mapping。
- integration: Firestore emulator等で同時claim、crash recovery、partial retry、storage消去。
- multi-client: stale plans snapshotを持つ2clientから同一itemを承認する。
- browser/manual: 2tab同時承認、network遮断、reload後retry。
- regression: single-client happy path、legacy preview、local cache round-trip。
- property/fuzz: operation item順序とretry回数を変えてPlan ID集合が一意であること。

## 14. リスク

- claimとPlan writeを別transactionにすると新しいcrash windowを作る。原子性またはrecovery手順を必須とする。
- `PlanSourceType`変更はrepository decoder、admin/report画面、既存test fixtureへ波及する。
- semantic fingerprintを安易に採用すると、ユーザーが意図した同時刻・同内容の別予定を誤って拒否する。
- retentionとaccount deletionは個人データ方針と整合させる。

## 15. Dependencies

- 先行必須:
  - `20260718-weekly-planning-approval-validation-session-binding.md`
  - `20260718-weekly-planning-approval-save-side-effect-isolation.md`
- 先行推奨:
  - `20260718-weekly-planning-approval-inflight-interruption.md`
  - `20260718-weekly-planning-user-boundary-storage-guard.md`
- 関連: Issue #51、trace privacy/account deletion task。

## 16. Exit conditions

- data model、transaction順序、state machine、error category、retention、migrationを文書化する。
- focused test、repository integration、週間計画suite、全test、TypeScript、production build、`git diff --check`が成功する。
- Firestore rule/index変更とemulator検証結果を報告する。
- localStorage ledgerの役割をcache/互換用途へ限定する。
- 完了時はcompletion recordへ統合し、rootから本taskを閉じる。

## 17. 実装担当への指示

1. `docs/ai/weekly-planning-docs-index.md`から現行文書を確認する。
2. `docs/ai/codex-task-guide.md`と`docs/ai/weekly-planning-pipeline-guide.md`に従う。
3. scope外へ広げず、stable provenanceのproduct判断が必要なら停止して報告する。
4. test結果、変更file、未確認事項を最終報告へ残す。
5. git操作はユーザーから明示された場合だけ行う。
