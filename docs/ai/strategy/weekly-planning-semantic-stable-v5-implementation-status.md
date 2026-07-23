# 週間計画 Stable V5 semantic実装status

Status: canonical implementation status / feature-flagged runtime trial connected
最終更新: 2026-07-23

関連文書:

- [current contract v5](../weekly-planning-current-contract-v5.md)
- [schema registry](../../architecture/weekly-planning-semantic-schema-registry.md)
- [Stable V5 migration plan](weekly-planning-semantic-stable-v5-migration-plan.md)
- [semantic v5 roadmap](weekly-planning-semantic-v5-roadmap.md)

この文書はStable V5の実装到達点を記録する。現在は既存UIから明示的に切り替えて試せるruntime trialまで接続済みである。ただしdefaultはlegacyであり、mainへのmerge、全ユーザーcutover、Graph永続化、旧経路削除を許可する状態ではない。

## 1. Stable識別子

```text
TypeScript document: WeeklyPlanningSemanticDocumentV5
TypeScript graph:    WeeklyPlanningFactGraphV5
schemaVersion:       weekly-planning-semantic-v5
JSON Schema name:    weekly_planning_semantic_document_v5
fact graph version:  weekly-planning-fact-graph-v5
```

Stable document、validator、canonicalizerはAlpha schema、Alpha validator、旧Fact Graph、旧canonicalizerへimportまたはprojectionしない。

## 2. 実環境runtime経路

既存の週間計画turn入口へ次のfeature-flagged経路を追加した。

```text
既存NaturalLanguageAssistant
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
→ 既存preview UI
→ 既存approval flow
→ Plan保存
```

AIが担当するのはユーザー発話の意味構造化だけである。次はアプリ側が決定する。

- schema validation
- fact IDとrevision
- short-answer target binding
- missing情報の優先順位
- 質問選択
- planning horizon解決
- existing plan / timetable制約
- task date eligibility
- fixed commitment
- availability
- 予定配置
- preview許可
- approval freshness
- 保存

provider failureまたはschema rejectionでparserへfallbackしない。

## 3. 有効化とrollback

通常はlegacy経路を使用する。Stable V5は次のいずれかで明示的に有効化する。

```text
アプリ設定
→ 週間計画AI
→ Stable V5
```

または開発・preview環境で次を使用できる。

```text
?weeklyPlanningRuntime=stable-v5
VITE_WEEKLY_PLANNING_RUNTIME_MODE=stable_v5
```

設定画面で「現行方式」へ戻すと即時rollbackできる。runtime切替時は会話、preview、Fact Graphを初期化し、旧世代とStable V5を同一conversationで混在させない。

## 4. Fact Graph V5 lifecycle

Fact Graph V5はfact本体を監査用に保持し、独立indexで次を管理する。

```text
active
superseded
removed
```

実装済み:

- expected revision確認
- duplicate turn防止
- operation key idempotency
- 同一fact kindへのsupersede
- active依存factを持つtargetの単独終了拒否
- correction intent transaction
- decision intentのaccept / reject
- inactive factのscheduler除外

未実装:

- proposal decisionの外部proposal stateへの実適用
- 依存fact一括終了transaction

## 5. multi-turn短答

直前の決定論質問に対する次の短答を、AIが意味構造化した後、アプリ側で単一の未解決factへ結合する。

```text
「3時間です」
→ missing_effort_estimateの対象へtotal_durationを追加

「今回進めたい量です」
→ quantity_role_unresolvedの対象workloadをsupersede
```

対象選択をAIへ任せない。expected revisionが一致し、短い応答で、未解決対象と構造化候補がそれぞれ一つの場合だけ結合する。長い別件入力、create_plan turn、availabilityやrelation等を同時に含む入力は短答として結合しない。

「この条件で予定を作って」のような作成許可だけのturnでは、planningIntentを`create_plan`とし、public stateの既存taskやconstraintを再出力しないprompt契約を追加した。

## 6. deterministic preview scheduler

Generic Scheduler Inputから既存preview候補を生成するruntime schedulerを追加した。

- default placement window: 09:00–22:00
- existing plansをoccupied intervalとして反映
- timetableをoccupied intervalとして反映
- hard fixed reservationを反映
- hard unavailable / occupiedを反映
- hard available windowを反映
- task allowed / excluded datesを反映
- splittable workを原則60分単位へ分割
- interval間にbufferを確保
- 全作業を配置できない場合はpartial previewを返さない

AIは日時配置を生成しない。existing planやtimetableの本文・event ID・日時をAIへ送らない。

## 7. previewとapproval

Stable previewは次へ拘束する。

- owner ID
- conversation ID
- Fact Graph revision
- source fact refs
- task ID
- PlanType

次のturnでGraph revisionが進んだ場合、古いpreviewは`recompute_required`となり承認できない。非学習taskは既存UIでも`other`として保存する。

## 8. sessionと保存境界

現時点のFact Graph V5はconversation-bound memory storeで保持する。最大24 sessionを保持し、owner mismatchを拒否する。

Graph V5のproduction persistence migrationはまだ行わない。そのためStable V5モード中は、会話、preview、draftをlocalStorageへ永続化しない。ページ再読込後に会話だけ復元されGraphが失われる不整合を防ぐため、再読込時は新規sessionから開始する。

実装済みのpure persistence基盤:

- Graph V5 validator / serializer / parser
- owner-bound envelope
- migration metadata
- unknown version / owner mismatch / broken graph rejection
- executor generation guard

未実装:

- 現行production stateからGraph V5へのdeterministic decoder
- repositoryへのGraph V5保存
- migration dry-run

## 9. read-only shadowとreal-eval

Stable V5 shadow evaluatorと専用real-eval harnessは実装済みである。raw conversation、raw response、semantic本文、外部予定本文はtelemetryへ保存しない。

production turnからのshadow telemetry保存は未接続である。runtime trialではconsoleへ次の非内容情報だけを出す。

- schema version
- graph revision
- normalizer attempt count
- repair有無
- scheduler status
- candidate count

## 10. test追加範囲

- runtime mode切替
- Stable runtime turn統合
- direct schema / validator / canonicalizer
- normalizer repair / fail closed
- creation authorizationで既存factを再出力しないprompt
- short-answer contextual binding
- stale revision / 長い別件入力の短答誤結合防止
- task → 3時間です → この条件で予定を作って、の三段階pipeline
- Graph V5 lifecycle
- task date / fixed commitment / availability
- generic scheduler input
- deterministic preview placement
- existing plan conflict回避
- insufficient capacity時のpartial preview禁止
- non-study PlanType保持
- preview revision freshness
- production接続点限定
- persistence envelope / cutover guard

## 11. 検証状況

Stable V5追加後のrepository全体について、次はまだ成功確認できていない。

```text
semantic全test
runtime integration test
Worker routing test
tsc --noEmit
Vite production build
Stable V5実AI real-eval
実ブラウザ操作
```

GitHub Actionsはrunnerのstep開始前に終了し、step、log、artifactが生成されない状態が継続している。このfailureは実行基盤失敗であり、コード不合格またはAI評価失敗とは判定しない。

したがって「実環境経路を実装済み」と「実ブラウザで成功確認済み」を区別する。

## 12. 現在未接続・未完了の範囲

```text
Graph V5 repository persistence
旧state migration
production shadow telemetry保存
calendar production adapter
personalization scoring
plan/actual learning pipeline
full renderer統合
全ユーザーdefault cutover
Alpha runtime依存削除
```

## 13. 次gate

```text
repository全体のautomated verification
→ branch previewでStable V5を有効化
→ 実AI structured output確認
→ 実browser roleplay
→ 発見不具合修正
→ read-only production shadow
→ migration decoder / dry-run
→ rollback verification
→ default cutover判断
→ full roleplay / 七視点監査
```

PR #77はDraftのまま維持し、検証前にmainへmergeしない。
