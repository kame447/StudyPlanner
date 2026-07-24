# 週間計画 Stable V5 semantic実装status

Status: canonical implementation status / feature-flagged runtime connected
最終更新: 2026-07-24
Reviewed main baseline: `a669b166db30fa3f355371c089062eb5cf4e3987`

関連文書:

- [runtime trial contract](../weekly-planning-stable-v5-runtime-trial-contract.md)
- [current contract v5](../weekly-planning-current-contract-v5.md)
- [schema registry](../../architecture/weekly-planning-semantic-schema-registry.md)
- [Stable V5 migration plan](weekly-planning-semantic-stable-v5-migration-plan.md)
- [semantic v5 roadmap](weekly-planning-semantic-v5-roadmap.md)
- [trace continuity七視点監査](../audits/20260724-stable-v5-trace-continuity/final-overseer.md)

この文書はStable V5の実装到達点を記録する。PR #77でStable V5 runtime path、PR #79でbrowser session persistenceとGraph commit atomicityをmainへ導入済みである。default runtimeはlegacyであり、全ユーザーcutoverではない。PR #83では同一logical conversationのtrace continuityをcontroller、local cursor、remote server handleまで修正する。

## 1. Stable識別子

```text
TypeScript document: WeeklyPlanningSemanticDocumentV5
TypeScript graph:    WeeklyPlanningFactGraphV5
schemaVersion:       weekly-planning-semantic-v5
JSON Schema name:    weekly_planning_semantic_document_v5
fact graph version:  weekly-planning-fact-graph-v5
```

Stable document、validator、canonicalizer、Fact GraphはAlpha schema、Alpha validator、旧Fact Graph、旧canonicalizerへprojectionしない。Alpha世代はlegacy evaluation recordとして残る。

## 2. production runtime経路

```text
NaturalLanguageAssistant
→ weeklyPlanningTurnExecutor
→ runtime mode判定
→ Stable V5 OpenAI-compatible structured output
→ direct Stable validator
→ lifecycle付きcanonicalizer
→ conversation-bound Fact Graph V5
→ active fact read view
→ generic scheduler input
→ deterministic dialogue policy
→ deterministic preview scheduler
→ existing preview UI
→ existing approval flow
→ Plan保存
```

AIはユーザー発話の意味構造化だけを担当する。schema validation、fact ID、revision、short-answer binding、readiness、question selection、planning horizon、existing plan / timetable制約、availability、placement、preview、approval、saveはアプリ側が決定する。provider failureまたはschema rejectionでparserへfallbackしない。

## 3. runtime modeとrollback

通常はlegacyを使用する。Stable V5は設定画面、query parameter、environment variableで明示的に有効化する。

```text
アプリ設定 → 週間計画AI → Stable V5
?weeklyPlanningRuntime=stable-v5
VITE_WEEKLY_PLANNING_RUNTIME_MODE=stable_v5
```

runtime切替時はconversation、preview、draft、Fact Graph、persisted Stable V5 envelopeを同時に初期化し、同一conversationへ異なるruntime generationを混在させない。

## 4. Fact Graph lifecycleとatomic commit

実装済み:

```text
expected revision確認
duplicate turn防止
operation key idempotency
active / superseded / removed lifecycle
同一fact kindへのsupersede
correction intent transaction
decision intentのaccept / reject
inactive factのscheduler除外
request単位のstaged Graph
PlanningState commit受理後だけGraph finalize
stale / cancel / commit rejection / failure時のstage破棄
```

未実装:

```text
proposal decisionの外部proposal stateへの実適用
依存fact一括終了transaction
server repositoryへのGraph persistence
```

## 5. multi-turnとidentity

直前の決定論質問への短答を、AIが意味構造化した後、アプリ側で単一の未解決factへ結合する。対象選択をAIへ任せず、expected revision、短答形、単一target、単一candidateを満たす場合だけ適用する。

conversation IDを復元した場合、controllerはPlanningStateに保存されたmessage IDとrevisionからsequenceの単調下限を復元する。再マウント後に`turn:1`、`request:1`、message IDを再発行しない。`clear_conversation`でmessagesが空になっても、同じconversation内の過去request IDへ戻らない。

## 6. deterministic preview scheduler

実装済み:

```text
default placement window 09:00–22:00
existing plans / timetableのoccupied interval反映
hard fixed reservation反映
hard unavailable / occupied反映
hard available window反映
task allowed / excluded date反映
splittable workの分割
buffer確保
insufficient capacity時のpartial preview禁止
non-study PlanType保持
```

AIは日時配置を生成しない。existing planやtimetableの本文、event ID、日時をAIへ送らない。

## 7. previewとapproval

Stable previewはowner ID、conversation ID、Fact Graph revision、source fact refs、task ID、PlanTypeへ拘束する。Graph revisionが進んだ古いpreviewは`recompute_required`となり承認できない。

preview、draft、approvalはPlanningStateとGraphの整合を維持し、pending approval中の半端なsnapshotを保存しない。

## 8. browser session persistence

PR #79でowner・week・conversationに拘束したStable V5 envelopeをlocalStorageへ導入済みである。

保存対象:

```text
conversation ID
完了済みPlanningState
Fact Graph V5
preview candidates
draft blocks
savedAt
```

復元時にowner、week、conversation、Graph source、preview freshness、size、schemaを検証する。不正または部分的なenvelopeは全体を破棄する。

これは同一browser内の保存であり、server repositoryまたはcross-device Graph persistenceではない。旧PlanningStateからStable V5 Graphへのdeterministic migration decoderは未実装である。

## 9. Stable V5 trace continuity

既存trace repositoryへuser / assistant turn、structured internal event、preview event、state snapshot、failureを記録する。raw provider responseとstack traceは保存しない。

2026-07-24の実トレースから、conversation persistence後にcontroller、trace runtime、remote repositoryのidentityが別々に初期化され、同じ`logicalConversationId`が複数trace sessionへ分裂する不具合を確認した。PR #83で次を修正する。

```text
metadata-only trace cursor
owner + conversation scopeのlocal trace session継続
30分idle timeoutによる分割廃止
entry sequence / turn index継続
recent request ID dedupe継続
write成功後だけcounter commit
append失敗retryでsequenceを消費しない
controller revisionによるsequence下限
server-issued handleのowner/local-session保存
repository再生成後のhandle再利用
structural rejection時だけhandle再発行
transient append failureのsame-payload retry
```

cursorとserver handle mappingへconversation本文、assistant本文、semantic document、Fact Graph、raw UID、emailを保存しない。stored handleをowner認証の正本として扱わず、remote APIの認証とserver-side ownership検証を維持する。過去分割済みのlogsは自動mergeしない。

## 10. shadowとreal-eval

Stable V5 shadow evaluatorと専用real-eval harnessは実装済みである。raw conversation、raw response、semantic本文、外部予定本文はtelemetryへ保存しない。

production turnからのshadow telemetry保存は未接続である。Stable V5実AI real-evalとfull browser roleplayも完了扱いにしない。

## 11. automated test coverage

実装済みtest範囲:

```text
runtime mode切替
Stable runtime turn integration
direct schema / validator / canonicalizer
normalizer repair / fail closed
short-answer contextual binding
three-turn planning pipeline
Graph lifecycle / atomic staged commit
task date / fixed commitment / availability
generic scheduler input / deterministic preview placement
existing plan conflict回避
preview / draft / Graph browser復元
application unmount / remount後のconversation復元
trace record / dedupe / failure record
trace runtime memory消失後のsession continuity
1時間idle後のsession continuity
clear conversation + reload後のrequest ID非再利用
write failure retryのsequence atomicity
controller / reducer / traceを跨ぐ二turn結合
remote repository再生成後のserver handle continuity
stale handle recovery
transient append failureのsame-payload retry
cursor content非保存とclosed validation
```

本branchのtest、typecheck、buildはCIまたはlocal checkoutの実行結果を取得するまで成功確認済みと表記しない。現在のGitHub Actions failureはstep 0件・logsなしのrunner起動前failureであり、code test failureと区別する。

## 12. 現在未完了の範囲

```text
cross-tab同時実行のsequence reservation
abrupt page close時の最終trace durability
server / cross-device Graph persistence
旧state migration decoder / dry-run
production shadow telemetry
calendar production adapter
personalization scoring
plan/actual learning pipeline
full renderer統合
Stable V5実AI real-eval
full browser roleplay
全ユーザーdefault cutover
legacy runtime / Alpha runtime依存削除
```

## 13. 次gate

```text
focused trace tests
→ full Vitest
→ typecheck
→ production build
→ branch previewでreload・1時間idle・clear後再送を実操作
→ admin exportが同一sessionへ結合されることを確認
→ unresolved review thread 0
→ review
→ production trial継続判断
```

PR #83はこのgateの結果取得までDraft・merge不可を維持する。
