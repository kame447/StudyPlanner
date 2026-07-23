# 週間計画 Stable V5 semantic実装status

Status: canonical implementation status / feature-flagged runtime connected
最終更新: 2026-07-24
Reviewed main baseline: `a669b166db30fa3f355371c089062eb5cf4e3987`

関連文書:

- [runtime trial contract](../weekly-planning-stable-v5-runtime-trial-contract.md)
- [current contract V5](../weekly-planning-current-contract-v5.md)
- [schema registry](../../architecture/weekly-planning-semantic-schema-registry.md)
- [Stable V5 migration plan](weekly-planning-semantic-stable-v5-migration-plan.md)
- [semantic V5 roadmap](weekly-planning-semantic-v5-roadmap.md)
- [trace continuity seven-view audit](../audits/20260724-trace-conversation-continuity/seven-view-audit.md)

この文書はStable V5の実装到達点を記録する。PR #77とPR #78は`main`へ統合済みであり、既存UIから明示的に切り替えて利用できる。defaultは環境変数で変更されない限りlegacyである。Stable V5 local persistenceは実装済みだが、別端末cloud sync、default cutover、旧経路削除は未完了である。

## 1. Stable識別子

```text
TypeScript document: WeeklyPlanningSemanticDocumentV5
TypeScript graph:    WeeklyPlanningFactGraphV5
schemaVersion:       weekly-planning-semantic-v5
JSON Schema name:    weekly_planning_semantic_document_v5
fact graph version:  weekly-planning-fact-graph-v5
```

Stable document、validator、canonicalizerはAlpha schema、Alpha validator、旧Fact Graph、旧canonicalizerへprojectionしない。

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

AIはユーザー発話の意味構造化だけを担当する。schema validation、fact ID、revision、short-answer target binding、missing優先順位、質問、planning horizon、既存予定制約、availability、placement、preview、approval、saveはアプリ側が決定する。provider failureまたはschema rejectionでparserへfallbackしない。

## 3. 有効化とrollback

```text
アプリ設定
→ 週間計画AI
→ Stable V5
```

開発・preview環境では次を使用できる。

```text
?weeklyPlanningRuntime=stable-v5
VITE_WEEKLY_PLANNING_RUNTIME_MODE=stable_v5
```

設定画面でlegacyへ戻すと即時rollbackする。runtime切替時は会話、preview、Fact Graph、local Stable V5 sessionを初期化し、異なるgenerationを同一conversationで混在させない。

## 4. Fact Graph V5 lifecycle

Fact Graph本体を監査可能な形で保持し、独立indexで`active`、`superseded`、`removed`を管理する。

実装済み:

```text
expected revision
applied turn key dedupe
operation key idempotency
same-kind supersede
active dependency guard
correction intent transaction
decision intent accept / reject
inactive fact scheduler exclusion
owner / conversation binding
```

未実装:

```text
proposal decisionの外部proposal stateへの実適用
依存fact一括終了transaction
```

## 5. multi-turn短答

直前の決定論質問に対する短答を、AIが意味構造化した後、アプリ側で単一の未解決factへ結合する。

```text
3時間です
→ missing_effort_estimateの対象へtotal_durationを追加

今回進めたい量です
→ quantity_role_unresolvedの対象workloadをsupersede
```

expected revision、短答形、単一target、単一candidateを満たす場合だけ結合する。長い別件入力、create_plan turn、availabilityやrelation等を含む入力は短答として結合しない。作成許可turnではpublic stateの既存factをAIに再出力させない。

## 6. deterministic preview scheduler

実装済み:

```text
default placement window 09:00–22:00
existing plans conflict avoidance
timetable conflict avoidance
hard fixed reservation
hard unavailable / occupied
hard available window
task allowed / excluded dates
splittable workの分割
buffer
partial preview禁止
non-study PlanType保持
```

AIは日時配置を生成しない。existing planやtimetableの本文、event ID、日時をAIへ送らない。

## 7. previewとapproval

Stable previewはowner ID、conversation ID、Fact Graph revision、source fact refs、task ID、PlanTypeへ拘束する。Graph revisionが進んだ古いpreviewは`recompute_required`となり承認できない。preview、draft、approval operationを別lifecycleとして扱う。

## 8. Stable V5 local session persistence

2026-07-23の実装で、Fact Graph V5はsession-memory onlyから同一browser profile内のlocal persistenceへ進んだ。

保存対象:

```text
version
owner ID
week start date
conversation ID
Fact Graph V5
PlanningState messages
compatibility intake state
preview candidates
draft blocks
savedAt
```

保存禁止:

```text
pendingTurn
pendingApproval
session-local proposal records
未完了network request ownership
```

load時はowner、week、conversation、Graph source、preview metadata、draft metadata、size、timestamp、shapeを検証する。破損またはcross-owner payloadはfail closedで削除する。ページ再読込後は会話とGraphを同じconversation IDで復元する。

これはlocal persistenceであり、別端末cloud syncまたはcloud authoritative revisionではない。

## 9. quality trace continuity

PR #82以前はtrace physical session ID、sequence、turn index、request dedupeがmodule memory onlyであり、同じlogical conversationがreloadまたは30分idle後に別ログへ分割された。

PR #82で次を実装する。

```text
trace scope = user ID + conversation ID
stable local physical session ID
sequence continuity
turn index continuity
bounded request ID dedupe
closed continuity envelope
idle timeoutによる分割廃止
server-issued handle persistence
repository再生成後のhandle再利用
structural rejection時だけhandle再発行
transient failure時は同一canonical payloadをretry
```

過去に分割されたtrace documentは自動mergeしない。trace writeはturn commit後のbest-effort side effectであり、abrupt page close時の最終turn durabilityは後続課題である。

## 10. automated test coverage

既存coverage:

```text
runtime mode切替
Stable runtime turn統合
direct schema / validator / canonicalizer
normalizer repair / fail closed
short-answer contextual binding
Graph lifecycle
task date / fixed commitment / availability
generic scheduler input
deterministic preview placement
preview revision freshness
persistence envelope / cutover guard
```

PR #82追加coverage:

```text
runtime memory loss後の同一trace session
1時間無操作後の同一trace session
別conversationのsession分離
sequence / turn index連続性
request ID dedupe復元
remote repository再生成後のserver handle再利用
stale handle recovery
transient append failureのsame-handle retry
```

## 11. verification state

PR #82の一時workflowで次を実行する。

```text
focused trace tests
full test suite
tsc --noEmit
Vite production build
git diff --check
```

結果は七視点監査へ記録し、一時workflowを削除する。実AI real-eval、実browser roleplay、複数tab、別端末、本番Firestore設定はautomated verificationと区別する。

## 12. 未接続・未完了

```text
cloud authoritative conversation session store
別端末復元
revision conflict / offline sync / migration
read-only production shadow telemetry
calendar production adapter
personalization scoring
plan / actual learning pipeline
default cutover
Alpha runtime依存削除
trace final-turn durable queue
```

## 13. 次gate

```text
PR #82 automated verification
→ browser reload / idle / reset roleplay
→ Stable V5実AI structured output確認
→ read-only production shadow
→ cloud session repository / migration dry-run
→ rollback verification
→ default cutover判断
→ full roleplay / 七視点監査
```

PR #82はDraftのまま維持し、検証前にmergeしない。
