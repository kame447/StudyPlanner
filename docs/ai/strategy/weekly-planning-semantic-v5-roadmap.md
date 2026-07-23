# 週間計画 汎用意味モデル v5 ロードマップ

Status: canonical / active post-runtime-integration queue
最終更新: 2026-07-24

- [Runtime trial contract](../weekly-planning-stable-v5-runtime-trial-contract.md)
- [Current contract](../weekly-planning-current-contract-v5.md)
- [Implementation status](weekly-planning-semantic-stable-v5-implementation-status.md)
- [Stable V5 migration plan](weekly-planning-semantic-stable-v5-migration-plan.md)
- [Schema registry](../../architecture/weekly-planning-semantic-schema-registry.md)
- [Trace continuity七視点監査](../audits/20260724-stable-v5-trace-continuity/final-overseer.md)

この文書はsemantic v5移行streamのqueue正本である。Stable V5 direct moduleとfeature-flagged runtime connectionはmainへ導入済みである。現在の中心課題はruntime trialの品質固定、real-eval、browser roleplay、shadow、migration、default cutoverである。

## 1. 到達済みruntime

```text
自然文
→ Stable V5 AI Semantic Normalizer
→ WeeklyPlanningSemanticDocumentV5
→ direct runtime validation
→ direct lifecycle canonicalizer
→ WeeklyPlanningFactGraphV5
→ active fact read view
→ generic scheduler input
→ readiness / acknowledgement / question policy
→ deterministic preview scheduler
→ preview / approval / save
```

browser内ではconversation、PlanningState、Fact Graph、preview、draftを一体復元する。Graph更新はrequest単位にstageし、PlanningState commit受理後だけfinalizeする。

default runtimeはlegacyである。

## 2. Gate status

### V5-A: documents and schema generations

Status: complete

- architecture v5、schema overview、availability architecture、current contract、migration plan、roadmap、schema registryを正本化した。
- pre-V5、Alpha 1、Alpha 2、Stable V5、Fact Graph V1/V2/V5の責務と廃止条件を分離した。
- Stable識別子を確定した。

### V5-B: direct Stable semantic document

Status: runtime connected

- generic task、component、workload、effort、temporal、recurrence、relationを分離した。
- constraint level、availability declaration、named time period、source requestを扱う。
- non-consecutive dateとweekday集合をclosed schemaで扱う。
- Stable schema、prompt、validator、normalizerをAlpha projectionなしで実装した。
- 最大一回repair、provider failure fail-closed、parser fallbackなしを実装した。

Remaining:

- full automated verificationの継続運用
- Stable V5 actual AI real-eval

### V5-C: Fact Graph lifecycle and transaction

Status: runtime connected

- direct Fact Graph V5、formal ID、revision、atomic canonicalizationを実装した。
- active / superseded / removed lifecycleを実装した。
- correction / decision transactionを実装した。
- active read view、resolver、scheduler inputへ接続した。
- staged GraphとPlanningState commitの原子的境界を実装した。

Remaining:

- proposal decisionの外部proposal ledgerへの実適用
- 依存fact一括終了transaction
- server repository persistence

### V5-D: dialogue and scheduler

Status: runtime connected

- accepted fact diff、readiness、質問選択、authorization、preview gateをdeterministic coreへ置いた。
- existing plan、timetable、fixed commitment、availability、task date eligibilityをschedulerへ統合した。
- partial preview禁止、buffer、split、non-study PlanTypeを実装した。

Remaining:

- accepted fact acknowledgementのgrounding回帰強化
- exam/general rendererの最終統合
- full browser roleplay

### V5-E: browser persistence and identity

Status: implemented / trace continuity fixed on current branch

- owner・week・conversation拘束のStable V5 envelopeを実装した。
- conversation、Graph、preview、draftを一体復元する。
- pending turn / approvalの半端なsnapshotを保存しない。
- controllerは復元messageから次turn sequenceを再構成する。
- traceはmetadata-only cursorから同じsession、entry sequence、turn indexへ復帰する。
- append失敗時にsequenceを消費しないtransactional trace writeを実装した。

Remaining:

- cross-tab同時実行のbrowser-wide sequence reservation
- server / cross-device persistence

### V5-F: external source acquisition

Status: pure module complete / production adapter remaining

- `success(events)`と`failure(reason)`へ限定した。
- empty successとfailureを区別する。
- partial resultを上位へ渡さない。
- temporary failureを自動再試行する。
- owner mismatchまたは不正eventでimport全体を拒否する。

Remaining:

- calendar production adapter
- operational retry metrics

### V5-G: real-eval and shadow

Status: harness/module implemented / production invocation not connected

- Stable V5専用real-eval harnessを実装した。
- version付きread-only shadow evaluatorを実装した。
- raw response、raw conversation、semantic本文、external event本文をreportへ保存しない。

Remaining:

- actual AI real-eval
- sampling、retention、timeout、privacy gate
- production shadow invocation

### V5-H: persisted migration

Status: design documented / implementation not started

- old envelope decoder
- deterministic migration input
- migration metadata
- idempotent atomic persist
- dry-run report
- rollback fixture

raw conversationからAIでSemanticDocumentを再生成してmigrationしない。

### V5-I: default cutover and legacy deletion

Status: not started

- cutover rehearsal
- session generation migration
- rollback verification
- default runtime decision
- observation period
- old prompt / command / exam adapter / Alpha runtime依存削除

## 3. 現在の進捗

```text
V5-A documents / schema registry       complete
V5-B direct semantic runtime           connected
V5-C Fact Graph lifecycle              connected
V5-D dialogue / scheduler              connected
V5-E browser persistence               implemented
V5-E trace continuity                  fixed on current branch
V5-F external source                   module complete / adapter pending
V5-G real-eval / shadow                harness ready / execution pending
V5-H persisted migration               not started
V5-I default cutover                    not started
```

## 4. 現在の依存順

```text
trace continuity focused tests
→ full Vitest / typecheck / production build
→ branch preview two-turn export verification
→ Stable V5 actual AI real-eval
→ full browser roleplay
→ read-only production shadow
→ old state migration decoder / dry-run
→ server / cross-device persistence decision
→ cutover rehearsal / rollback verification
→ default cutover decision
→ observation period
→ legacy runtime deletion
```

## 5. 直近priority

### P0: trace continuity verification

- focused test
- full test
- typecheck
- build
- browserで二turn継続
- admin exportが一つのsessionになることを確認

### P1: dialogue grounding

第二turnでacceptedした「院試」「ハードウェア」「OSnetwork」等をacknowledgementへ反映し、同じ一般質問だけを繰り返さない回帰を追加する。

### P1: cross-tab coordination

同一owner・week・conversationを複数tabで同時操作した場合にrequest、turn、trace sequenceを一意に予約する。Web Locksまたはserver-authoritative reservationを比較し、fallback時のfail-closed動作を決める。

### P2: actual AI real-eval / roleplay

Stable V5専用schemaで実AIを実行し、date、short answer、correction、availability、source request、authorization、previewまで確認する。

### P3: migration / shadow

old state decoderとdry-run fixtureを実装し、real-eval後にread-only shadowを接続する。

## 6. default cutover禁止条件

次のいずれかが残る場合、default runtimeをStable V5へ切り替えない。

- AIがinternal command、missing、readiness、preview、scheduler、saveを決める。
- parser fallbackが復活する。
- GraphとPlanningStateのcommitが非原子的である。
- owner、week、conversation、preview freshnessを検証しない。
- conversation復元後にturn/request/message IDを再利用する。
- 同一conversationのtraceが通常操作で分裂する。
- append failureがsequence gapを作る。
- external failureを予定0件として扱う。
- actual AI real-eval、full browser roleplay、rollback verification、七視点監査が未完了である。

## 7. current active records

- [20260724-weekly-planning-runtime-followups.md](../tasks/20260724-weekly-planning-runtime-followups.md)
- [20260722-weekly-planning-external-source-atomic-retry.md](../tasks/20260722-weekly-planning-external-source-atomic-retry.md)
- [20260722-weekly-planning-specific-date-and-personalization-profile.md](../tasks/20260722-weekly-planning-specific-date-and-personalization-profile.md)

完了済みtaskは`tasks/closed/`、契約変更で実行対象外になったtaskは`tasks/superseded/`へ移す。
