# Stable V5 verification・migration・default cutover

Status: active / feature-flagged runtime connected, adoption gates open
Priority: P1 after current trace blocker
Created: 2026-07-28

Supersedes:
- `superseded/20260722-weekly-planning-generic-semantic-v5-migration.md`
- `superseded/20260722-weekly-planning-v5-date-real-eval.md`

Absorbs remaining verification from:
- `closed/20260716-weekly-planning-entrypoint-request-ownership.md`
- `closed/20260716-weekly-planning-controller-ui-responsibility-split.md`
- `closed/20260722-weekly-planning-specific-date-and-personalization-profile.md`

## 1. 現在地

実装・接続済み:

- Stable V5 strict semantic document、validator、最大1回repair
- AI-only initial semantic interpretation
- direct lifecycle canonicalizerとFact Graph V5
- generic work item、scheduler input、readiness、dialogue、preview scheduler
- request-scoped staged Graph commit
- owner/week/conversation-bound local persistence
- existing preview、approval、Plan saveへのfeature-flagged接続
- request ownership、stale discard、IME guard、focus restoration
- specific date、non-consecutive date、weekday set、excluded date
- runtime mode rollback boundary

未完了gate:

- current branchを含むfull automated verification
- Stable V5 actual AI real-eval
- browser roleplay
- accepted fact acknowledgement grounding
- external source production adapter
- old persisted state migration decoder/dry-run
- production read-only shadow invocation
- rollback rehearsal
- default cutover decision
- observation period
- legacy runtime deletion

## 2. Actual AI real-eval

Stable V5 production schemaと同じ入口を使い、少なくとも次を評価する。

- 一日、今週、来週、非連続日
- 曜日集合とexact除外日
- short answer contextual binding
- task/component/workload/effort
- correction、remove、supersede
- availability、fixed commitment、existing plan
- external source request
- explicit create authorization
- insufficient capacity
- generic non-study task

判定はJSON shapeだけでなく、canonical Fact Graph、readiness、question、scheduler input、preview gateまで通して行う。raw responseはlocal artifactへ限定し、production traceへ無制限保存しない。

## 3. Browser roleplay

- close中に完了したturnをreopen後に表示
- selected week変更後のstale result破棄
- clear conversationとreset sessionの分離
- reload後のconversation/Graph/preview/draft復元
- IME composing中の誤送信防止
- Ctrl/Meta+Enterの一系統送信
- focus restoration
- approval stale/pending guard
- date、correction、availability、preview、approvalのmulti-turn
- admin trace exportとのturn対応

## 4. Migration・shadow・rollback

- old envelopeをversion付きdecoderで読み、deterministic migration inputへ変換
- raw conversationをAIへ再投入してmigrationしない
- idempotent atomic persist
- dry-run reportとrollback fixture
- Stable V5結果をproduction stateへ書かないread-only shadow
- sampling、timeout、retention、privacy gate
- legacy/Stable result差分をbounded metricで記録
- mode切替時に旧GraphとStable Graphを混在させない

## 5. Default cutover禁止条件

次のいずれかが残る場合はdefaultをStable V5へ変更しない。

- full automated verificationがred
- actual AI real-eval未実施
- browser roleplay未実施
- traceが同一conversationで分裂または欠落
- current-time hard boundary未実装
- GraphとPlanningState commitが非原子的
- parser fallbackが復活
- external failureを予定0件として扱う
- migration/rollback未検証
- unresolved blockerまたはmajor監査指摘がある

## 6. 完了条件

- [ ] focused/full test、typecheck、typecheck:build、build、diff checkがgreen
- [ ] actual AI real-eval reportを保存
- [ ] browser roleplayを実行し証跡を保存
- [ ] accepted fact groundingを回帰化
- [ ] migration decoder/dry-run/rollback fixtureを実装
- [ ] production shadowをprivacy gate付きで実行
- [ ] default cutover前七視点監査を完了
- [ ] rollback rehearsal成功
- [ ] observation periodで重大regressionなし
- [ ] default cutover後にのみlegacy削除taskを開始

実AI資格情報、browser環境、production deployが利用できない場合は、そのgateを未確認のまま残す。module test成功をbrowser/production採用へ読み替えない。