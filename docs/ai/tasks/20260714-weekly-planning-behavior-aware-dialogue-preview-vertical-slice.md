# 週間計画: 行動文脈を使った塾講師型対話からpreview生成までのvertical slice

Status: ready
Priority: highest
Scope: `src/features/weeklyPlanning/` のproductionコードとtestコード
Implementation unit: DA0r + 最小behavior derivation + DA1 + DA0 preview bridge
Dependencies:

- `docs/ai/tasks/20260714-weekly-planning-behavior-aware-planning-architecture.md` のdocs-only更新が完了していること
- 更新後の `docs/architecture/weekly-planning-dialogue-architecture-v4.md` が引き続きcanonical architectureであること
- DA0a assumption proposal foundationがmainへ反映済みであること
- weeklyPlanning test architecture refactorがmainへ反映済みであること

Git operation: prohibited

## 1. 目的

現在の週間計画対話は、`PlanningIntakeMissing`と`questionPlan`を中心に、次の不足slotを順番に質問する構造が強い。

この構造では、AI rendererが自然な日本語を生成しても、アプリが行っている判断自体は次の範囲に留まる。

```text
不足している項目を特定する
→ 順番に質問する
→ 条件が揃ったらdraftを作る
```

本タスクでは、既存の安全境界を維持したまま、対話判断を次へ変更する。

```text
現在のaccepted factから計画仮説を作る
→ 生活イベントとタスク特性を行動文脈として導出する
→ 予定への影響が大きい不確実性を判定する
→ 安全な候補があれば質問より先に提案する
→ ユーザーには候補の承認または差分修正を求める
→ ユーザーが仮予定作成を許可した場合だけpreviewを生成する
```

最終到達点は、canonical roleplay `WP-BEHAVIOR-001`を、漠然とした相談からpreview表示まで一連の実ブラウザ導線として成立させることである。

本タスクは一つのvertical sliceとして実行する。ただし、DA0r、behavior derivation、DA1、DA0 preview bridgeのmodule boundaryとtest boundaryは分離する。

## 2. 絶対条件

本mdに書かれた範囲を超えないこと。

実装前に、更新済みの次の文書を全文確認すること。

```text
docs/architecture/weekly-planning-dialogue-architecture-v4.md
docs/weekly-planning/weekly-planning-spec.md
docs/ai/strategy/weekly-planning-roadmap.md
docs/testing/weekly-planning-roleplay-test-plan.md
```

上記文書と本mdが矛盾する場合は、更新後のcanonical architectureを優先し、独断で別設計を追加しないこと。差異は最終報告で明示すること。

次の境界を必ず維持する。

```text
AI interpreter
  自然文からtyped candidateを抽出する

validator / adapter / reducer
  candidateを検証し、accepted stateまたはpending proposalへ反映する

DA0r deterministic core
  readiness、behavior、missing resolution、allowed actionを計算する

DA1 AI dialogue planner
  deterministic coreが許可したactionを自然な応答へ変換する

DA0 preview bridge
  preview gateを通過した場合だけ既存schedulerへ接続する
```

AIに次を決定させないこと。

```text
readiness stage
blocking dimension
hard deadline
available minutes
hard constraint
DraftGenerationIntent
preview生成可否
保存可否
suitability scoreの正解値
accepted factへの昇格
```

次を禁止する。

```text
漠然としたgoalだけでpreviewを生成する
pending proposalが存在するだけでpreviewを生成する
missing件数だけでpreview_readyにする
assistantが仮予定作成を提案しただけでpreviewを生成する
AI出力の自己申告でpreviewを生成する
planning hypothesisをaccepted factとして保存する
LifeActivityAnchorやannotationで既存availabilityを拡張する
hard busy interval、existing plan、timetableを上書きする
未確認の今週の習慣をrecurring profileへ永続化する
```

既存のexam intake、provider failure fallback、legacy fallback、preview個別削除、save approvalを壊さないこと。

## 3. 本タスクの到達シナリオ

`WP-BEHAVIOR-001`を代表シナリオとする。自然文の完全一致はproduction contractにしない。

```text
ユーザー:
英語やらないといけないんだよね

アプリ:
今週の予定についての相談かを確認する。
試験、宿題、提出物など、英語を進める理由を1件から2件の質問で絞る。
previewは生成しない。

ユーザー:
金曜日に英単語の小テストがあって、ワークも10ページくらい出ている

アプリ:
単語テストとワークを別task identityとして扱う。
金曜日のテストをdeadlineとして保持する。
単語は分散、ワークは連続作業という仮説候補を作る。
安全な候補を提示しつつ、ワーク1ページの目安時間を尋ねる。
previewは生成しない。

ユーザー:
10分から15分くらい

アプリ:
入力値をworkload estimateとして保持する。
余裕込みの作業量またはセッション長はderived rangeまたはpending proposalとして扱う。
accepted factへ無断で直書きしない。
生活上のアンカーまたは利用可能時間を確認する。

ユーザー:
夕食は19時で、帰宅は17時30分。朝は続かない。寝る前なら英単語をできそう

アプリ:
帰宅、夕食、就寝前をLifeActivityAnchorとして導出する。
朝を避ける条件はcurrent planまたはcurrent week scopeとする。
単語にbefore_sleep、ワークにafter_mealまたはlong_contiguous_windowを関連付ける。
仮予定案の考え方を提示し、作成してよいか確認する。
まだpreviewは生成しない。

ユーザー:
それじゃあ仮で予定を組んでみよう

アプリ:
DraftGenerationIntent=user_authorizedへ遷移する。
readiness、blockingDimensions、stateRevisionを再評価する。
preview gateを通過した場合だけschedulerを実行する。
初めてpreviewを表示する。
保存は行わない。
```

このシナリオで重要なのは、特定の応答文ではなく、各turnのstate transition、仮説、提案、preview gateである。

## 4. 非目標

本タスクでは次を行わない。

```text
DA1b assumption lifecycleの全面実装
assumption accept/reject/modify UIの再設計
profile memoryの永続化
user memoryの保存
scheduler全体の最適化または全面書換え
既存LifeConstraintのmigration
保存処理の再設計
approval idempotencyの再設計
UI/CSSの全面変更
音声会話専用処理
複数週間・長期学習計画への拡張
学習成果からの自動profile学習
```

既存DA0aのpending proposalは再利用してよいが、そのlifecycle全体を本タスクへ取り込まないこと。

## 5. 実装全体像

全体処理を次へ接続する。

```text
userText + structured context
  → single AI interpreter
  → typed candidates
  → normalize / validate / adapter / reducer
  → accepted facts / pending proposals

  → deterministic behavior derivation
      LifeActivityAnchor
      TaskExecutionProfile
      PlanningOpportunityAnnotation

  → PlanningReadinessSnapshot
  → MissingResolutionOpportunity
  → PlanningHypothesisSnapshot
  → AllowedDialogueActions

  → AI dialogue planner
  → response validator
  → deterministic fallback renderer

  → preview gate
  → existing scheduler / feasibility
  → preview blocks
  → UI表示
```

新しい処理を既存の巨大関数へ追加し続けないこと。

少なくとも次の責務を別moduleとして分離する。

```text
readiness policy / evaluator
draft generation intent transition
life activity anchor derivation
task execution profile derivation
opportunity annotation derivation
missing resolution classification
planning hypothesis builder
allowed dialogue action builder
AI dialogue response validation
preview gate / bridge
```

正確なファイル名は既存のdirectory責務に合わせて決めてよい。ただし、同じ関数がreadiness、dialogue文面、scheduler実行を同時に担当しないこと。

## 6. DA0r: readiness foundation

### 6.1 型と有限policy registry

canonical architectureに定義された次の型をproduction contractとして追加する。

```text
PlanningDimension
PlanningReadinessStage
PlanningReadinessPolicy
PlanningReadinessSnapshot
DraftGenerationIntent
MissingResolutionMode
ResolutionImpact
MissingResolutionOpportunity
LifeActivityAnchor
TaskExecutionProfile
PlanningOpportunityAnnotation
PlanningHypothesisSnapshot
```

必要な補助型として、次を追加してよい。

```text
AllowedDialogueAction
AllowedDialogueActionKind
PlanningBehaviorDerivationResult
PreviewGateResult
```

readiness policyは有限registryで管理する。

最低限、次のpolicyを分ける。

```text
non_exam_weekly_plan
exam_weekly_plan
```

magic number、hard required dimension、minimumResolvedCountを複数箇所へ直書きしないこと。

### 6.2 dimension resolution

既存の`PlanningIntakeState`、draft request、remaining work item、constraints、pending proposalsから各dimensionの解決状態をdeterministicに導出する。

最低限、次を扱う。

```text
planning_intent
planning_range
task_identity
goal_scope
workload
deadline
task_execution_profile
availability_basis
routine_anchors
```

`resolvedCount`は補助情報であり、単独でstageを決定しない。

non-exam roleplayでは、少なくとも次がpreview前のblocking判定に参加する。

```text
planning_range
task_identity
workload
availability_basis
高影響のdeadline uncertainty
各work itemの配置可能なexecution shape
```

routine anchorがないことだけを常にblockしない。明示的なavailable rangeがある場合は、それをavailability basisとして扱えるようにする。

### 6.3 DraftGenerationIntent

既存の`intent`、`status`、`shouldCreateDraft`と、preview生成への許可を分離する。

```ts
type DraftGenerationIntent =
  | 'not_requested'
  | 'assistant_suggested'
  | 'user_authorized';
```

`shouldCreateDraft`を直ちに全面削除する必要はない。移行期間のadapterとして残してよいが、preview gateの正は`DraftGenerationIntent`とreadinessに置く。

ユーザー発話による`user_authorized`への遷移は、typed command、validator、deterministic reducerを通す。

新しいcommand名は既存命名規則へ合わせる。意味としては次を保証する。

```text
明示的に仮予定、予定作成、組んでほしいと依頼した
  → user_authorized候補

漠然と「英語やらないと」「勉強しないと」と述べた
  → not_requested

アプリが仮予定作成を提案した
  → assistant_suggested
```

AI dialogue plannerの出力だけで`user_authorized`へ更新しないこと。

### 6.4 preview gate

preview gateを単独のpure functionとして実装する。

意味的に次と同じ条件を保証する。

```ts
const previewAllowed =
  readiness.stage === 'preview_ready'
  && readiness.draftGenerationIntent === 'user_authorized'
  && readiness.blockingDimensions.length === 0
  && readiness.stateRevision === currentStateRevision;
```

結果はbooleanだけでなく、拒否理由を有限reasonとして返す。

例:

```text
not_ready
not_user_authorized
blocking_dimension
stale_revision
missing_execution_shape
missing_availability_basis
```

拒否理由は内部diagnostic用であり、内部名をそのままユーザーへ表示しない。

## 7. 最小behavior derivation

### 7.1 LifeActivityAnchor

既存のaccepted life constraint、fixed event、timetable、明示factから、行動上のアンカーを導出する。

最低限、次を扱う。

```text
school
work
commute
meal
bath
sleep
rest
preparation
fixed_event
```

`WP-BEHAVIOR-001`では少なくとも次を導出する。

```text
帰宅17:30
夕食19:00
就寝前
```

LifeActivityAnchorはbusy intervalの代替ではない。

既存availability、buffer、hard constraintへ変更を加えず、sourceFactRefs、origin、scope、confidenceを保持する。

### 7.2 TaskExecutionProfile

既存task、StudyTaskScope、explicit fact、有限policy registryから、計画用の実行特性を導出する。

最低限、次のactivityを扱う。

```text
memorization
drill
reading
writing
problem_solving
project
review
unknown
```

`WP-BEHAVIOR-001`では少なくとも次を区別する。

```text
英単語
  activityKind=memorization
  distributionPolicy=spacedまたはsplittable
  短時間反復候補

ワーク
  activityKind=drill
  distributionPolicy=contiguousまたはsequential_units
  まとまった時間候補
```

「英単語なら必ず1日2回」「ワークなら必ず90分」のような固定値を直接埋め込まない。

明示fact、deterministic derivation、pending proposal、accepted assumptionを区別する。

### 7.3 PlanningOpportunityAnnotation

第三のavailabilityを新設しない。

既存available rangeに対して、次のannotationを付与する。

```text
before_meal
after_meal
after_school
after_work
after_commute
before_sleep
after_rest
long_contiguous_window
short_transition_window
low_activation
high_continuity
```

annotationはavailable minutesを増やさない。

annotationは候補枠の順位付け、対話上の説明、preview reasoning metadataにだけ利用する。

既存schedulerへ接続する場合は、既存のplacement scoreまたはpreferred rangeへ限定的なscore componentとして渡す。hard constraint判定より前に配置を確定しないこと。

### 7.4 current scope

「朝は続かない」などの発話は、初期実装ではcurrent planまたはcurrent week scopeに限定する。

一回の発話からrecurring profile、localStorage、repositoryへ保存しない。

## 8. MissingResolutionOpportunityとproposal-first policy

不足情報を単純な`missing slot`ではなく、解決方法つきのopportunityへ変換する。

```ts
type MissingResolutionMode =
  | 'derive_deterministically'
  | 'propose_default'
  | 'offer_options'
  | 'must_confirm';
```

最低限、次の分類を実装する。

| 不足内容 | mode |
| --- | --- |
| 相対日付の一意解決 | derive_deterministically |
| 1回または1単位の目安時間 | propose_default |
| 進める量の現実的な候補 | propose_defaultまたはoffer_options |
| 朝・夕方・夜の候補 | offer_options |
| 何の試験か | must_confirm |
| 何を学習するのか | must_confirmまたはoffer_options |
| ユーザーの目的 | must_confirm |
| hard deadline | must_confirmまたは明示factからderive |
| preferred completion buffer | propose_default |

安全な候補がある場合、自由回答だけの質問を唯一のactionにしない。

一turnで提示するproposalまたはquestionは原則1件から2件、多くても3件とする。

ユーザーが「分からない」「目安がない」と答えた場合は、同じ質問をそのまま繰り返さず、次のいずれかへ移る。

```text
propose_default
offer_options
first trial
```

first trialは、短い試行枠を置いて再見積もりする提案であり、無断でaccepted factへ書き込まない。

## 9. PlanningHypothesisSnapshot

accepted stateとpending proposalから、previewより前の内部計画仮説を生成する。

最低限、次を持つ。

```text
conversationId
stateRevision
taskProfiles
lifeActivityAnchors
opportunityAnnotations
resolutionOpportunities
readiness
suggestedNextAction
```

`suggestedNextAction`は有限値とする。

```text
acknowledge
propose_resolution
offer_options
ask_required_fact
suggest_draft_generation
generate_preview
```

同じcanonical state、policy registry、revisionからは同じsnapshotを生成する。

snapshotは予定ブロックを持たない。

snapshotをaccepted facts、repository、localStorageへ保存しない。

## 10. AllowedDialogueActions

PlanningHypothesisSnapshotから、現在のturnで実行可能なaction集合をdeterministicに作る。

最低限、次のactionを扱う。

```text
acknowledge_fact
ask_required_fact
propose_default
show_options
suggest_draft_generation
generate_preview
explain_clarification
report_infeasibility
```

各actionは少なくとも次を持つ。

```text
actionId
kind
topicId
sourceFactRefs
allowedProposalRefs
allowedOptionIds
maxItems
```

AI dialogue plannerへは、AllowedDialogueActionsに含まれないactionを実行させない。

`generate_preview`はpreview gate通過時だけaction集合へ含める。

## 11. DA1: AI dialogue planner

### 11.1 責務

既存のAI dialogue rendererを、単なる`questionPlan`言い換えから、許可されたactionを自然な会話へ変換するplannerへ拡張する。

AIへ渡す情報は、必要最小限のstructured dataに限定する。

```text
accepted factsの表示用要約
PlanningHypothesisSnapshotの表示可能部分
AllowedDialogueActions
直近の会話履歴
style constraints
```

private source、内部diagnostic、未許可のpending dataを渡さない。

AIは次を返すstructured responseとする。

```text
acknowledgement
selectedActionIds
proposalまたはquestionの表示文
option labels
reasoning summaryの表示文
```

schemaの正確な形は既存renderer contractへ合わせてよい。

### 11.2 response validator

AI responseを表示前に検証する。

最低限、次を拒否する。

```text
AllowedDialogueActionsに存在しないactionId
許可されていないslotまたはtopicへの質問
存在しないproposal refまたはoption id
1turnの上限を超える質問・提案
preview gateを通っていないgenerate_preview
accepted factにないdeadlineや時刻の断定
内部slot名、reasonCode、readiness score、suitability scoreの露出
保存または確定を行ったと誤認させる表現
```

validation failure、schema parse failure、provider failureではdeterministic fallbackへ戻る。

fallbackでもproposal-first policyと1turn上限を維持する。

### 11.3 自然な応答の条件

自然文のgolden text完全一致を増やさない。

ただし、応答構造として次を満たす。

```text
直前のユーザー情報を短く受け止める
現在の仮説または候補を説明する
必要な確認を1件から2件だけ行う
ユーザーが修正しやすい答え方を提示する
```

例:

```text
金曜日に単語テストがあるなら、単語は今日から少しずつ分ける案がよさそうです。
ワークはまとまった時間を取りたいので、1ページにどのくらいかかりそうですか？
```

この文章自体をcontractにしない。

## 12. DA0: non-exam preview bridge

### 12.1 bridge条件

次の場合だけ既存schedulerを呼ぶ。

```text
preview gateがallowed
DraftGenerationIntent=user_authorized
blockingDimensionsが空
stateRevisionが一致
各work itemにexecution shapeがある
availability basisがある
```

`hypothesis_ready`、`proposal_ready`ではschedulerを呼ばない。

### 12.2 scheduler入力

既存scheduler contractを維持する。

新しいbehavior情報は、必要なadapterを通して次へ限定的に渡す。

```text
task execution shape
preferred completion target
opportunity suitability
current-week preference
pending assumption refs
source fact refs
```

hard constraint、existing plan、timetable、bufferの既存処理は変更しない。

scheduler全面改修は行わない。

### 12.3 preview metadata

生成されたpreviewへ、説明と再評価に必要なmetadataを保持する。

最低限、次を追跡可能にする。

```text
stateRevision
sourceFactRefs
usedAssumptionProposalRefs
taskProfileRefまたはtaskRef
opportunity tags
reasoning codeまたはdeterministic phrase key
```

preview metadataをユーザー向け内部コードとしてそのまま表示しない。

preview生成後もsaveは実行しない。

既存のpreview個別削除とstable identityを維持する。

## 13. 既存実装との接続

現在の`weeklyPlanningDialogueManager.ts`は、`PlanningIntakeMissing`、`questionPlan`、`shouldCreateDraft`を中心にdecisionを作っている。

本タスクでは、既存decisionを全面削除せず、次の移行を行う。

```text
従来のmissing判定
  → readiness / resolution opportunityへadapter

従来のquestionPlan
  → AllowedDialogueActionsのask_required_fact fallbackへ縮小

従来のshouldCreateDraft
  → DraftGenerationIntent + preview gateへ置換またはadapter化

従来のAI renderer
  → AllowedDialogueActionsを受け取るAI dialogue plannerへ拡張
```

既存exam flowが一度に新architectureへ完全移行できない場合、exam policyは互換adapterを通してよい。

non-exam roleplayだけを別の未接続pipelineとして実装しない。実際のweekly planning entrypointから到達できるようにする。

## 14. 実装順序

次の順で実施する。

### 14.1 baseline固定

変更前に、次の既存テストを実行してbaselineを確認する。

```text
weeklyPlanning intake
dialogue manager
AI dialogue renderer
assumption proposals
availability slots
placement properties
preview blocks
主要roleplay
```

失敗がある場合は、本タスク由来か既存失敗かを記録する。

### 14.2 DA0r pure foundation

最初にpure moduleとunit/property testを追加する。

```text
policy registry
dimension resolver
readiness evaluator
DraftGenerationIntent transition
preview gate
```

この段階ではschedulerやAI rendererを接続しない。

### 14.3 behavior derivation

次にpure derivationを追加する。

```text
LifeActivityAnchor
TaskExecutionProfile
PlanningOpportunityAnnotation
MissingResolutionOpportunity
PlanningHypothesisSnapshot
AllowedDialogueActions
```

### 14.4 DA1接続

AI dialogue planner、response schema、validator、deterministic fallbackを実装する。

### 14.5 DA0 bridge接続

preview gateを既存scheduler invocationの直前へ接続する。

behavior metadataを既存schedulerへ限定的に渡し、previewへmetadataを付加する。

### 14.6 end-to-end roleplay

最後に`WP-BEHAVIOR-001`を実際のentrypoint経由で通す。

途中段階の内部APIを直接つないだだけで完了扱いにしない。

## 15. テスト要件

テストは、契約テスト、property-based test、代表シナリオテスト、既存回帰テストに分ける。

### 15.1 契約テスト

最低限、次を確認する。

```text
DraftGenerationIntentのtyped transition
vague goalではuser_authorizedにならない
明示的な仮予定作成依頼でuser_authorizedになる
AI responseだけではintentが変化しない
finite readiness policy registry
blocking dimension判定
preview gate reason
AllowedDialogueActions外のAI action拒否
provider failure fallback
preview metadataのsource refs
```

### 15.2 property-based test

既存の`fast-check`を利用し、固定seedとbounded runを指定する。

最低限、次を独立したpropertyとして実装する。

```text
no premature preview
authorization gate
count alone is insufficient
order independence
irrelevant fact independence
deterministic hypothesis
proposal-first resolution
hard constraint preservation
no availability fabrication
scope isolation
mutation prohibition
conflict handling
```

一つの巨大propertyへまとめない。

無効値だけを大量生成するgeneratorにしない。

失敗時に性質を特定できる粒度を維持する。

### 15.3 WP-BEHAVIOR-001

roleplay testでは自然文完全一致ではなく、各turnで次を確認する。

| turn | assertion |
| --- | --- |
| 漠然とした英語goal | explorationまたはtask candidate、previewなし、intentはnot_requested |
| 金曜テストとワーク | task identity、deadline、workload、profile候補、previewなし |
| 1ページ10〜15分 | estimate保持、余裕込み値をaccepted factへ直書きしない |
| 帰宅・夕食・朝回避・寝る前 | anchor、scope、annotation、task profile |
| 仮予定作成への同意 | user_authorized、revision一致、gate再評価 |
| preview | 初回生成、metadataあり、saveなし、hard constraint違反なし |

AI provider successとdeterministic fallbackの両方で、許可されたaction構造が維持されることを確認する。

### 15.4 既存回帰

最低限、次を維持する。

```text
WP-RP系の主要exam scenario
provider failure fallback
legacy fallback境界
task provenance
fixed eventとlife constraint
preview stable identityと個別削除
3300分などの大規模配置回帰
availabilityとbuffer
placement time conservation
```

## 16. 実ブラウザ確認

自動テスト後、実ブラウザで次を確認する。

```text
1. 「英語やらないといけない」と入力する
2. すぐpreviewが出ない
3. アプリが目的を絞る自然な確認を返す
4. 金曜の単語テストとワーク10ページを伝える
5. 単語とワークを別の実行特性として提案する
6. 目安時間を伝える
7. 帰宅、夕食、朝回避、寝る前を伝える
8. 仮予定作成前に案を説明する
9. 「仮で組んで」と明示する
10. 初めてpreviewが生成される
11. 既存予定、時間割、bufferと重ならない
12. previewは保存済み予定になっていない
```

応答文が不自然な場合、AI promptだけを場当たり的に修正しない。

原因を次へ分類する。

```text
interpreter candidate不足
accepted state不足
behavior derivation不足
readiness誤判定
resolution mode誤判定
AllowedDialogueActions不足
AI planner表現問題
response validator過剰または不足
scheduler placement問題
```

## 17. 検証

実装後に最低限、次を実行する。

```bash
git diff --check
npm test -- --run
npm run build
npx tsc --noEmit
```

repositoryに対象test用のより限定的なcommandがある場合は、先にtargeted testを実行し、その後full testを実行する。

lint scriptが存在する場合は実行する。存在しない場合は新設しない。

property-based testのseed、numRuns、失敗時counterexampleを最終報告に含める。

実ブラウザ確認を実行できない場合は、実行できなかった理由と、代替として確認したintegration boundaryを明記する。

## 18. 完了条件

次をすべて満たした場合だけ完了とする。

```text
DA0rのreadinessとpreview gateがdeterministicに実装されている
DraftGenerationIntentが既存planning intentから分離されている
最小LifeActivityAnchorが実entrypointから導出される
英単語とワークのTaskExecutionProfileが区別される
PlanningOpportunityAnnotationがavailabilityを増やさない
MissingResolutionOpportunityがproposal-first actionを生成する
AllowedDialogueActions外のAI応答が拒否される
provider failureでdeterministic fallbackへ戻る
「英語やらないと」だけではpreviewが生成されない
「仮で組んで」の明示後だけpreview gateを通れる
WP-BEHAVIOR-001が実entrypoint経由でpreviewまで到達する
preview metadataにsource refsとassumption refsが残る
既存exam flowと主要回帰がgreen
full test、build、tscが成功
production state、hypothesis、preview、saved planの境界が維持される
```

テストを通すためだけにroleplay固有の文字列分岐をproductionへ追加しないこと。

## 19. 最終報告

最終報告には次を含める。

```text
変更ファイル
追加したmodule boundary
DraftGenerationIntentの遷移方法
readiness policyとpreview gate
LifeActivityAnchorの導出元
TaskExecutionProfileの有限policy
PlanningOpportunityAnnotationのscheduler接続方法
MissingResolutionOpportunityの分類
AllowedDialogueActionsとAI response validator
WP-BEHAVIOR-001の各turn結果
preview metadata
property-based test一覧、seed、numRuns
既存回帰の結果
full test、build、tsc結果
実ブラウザ確認結果
scope外として残した課題
```

次を明記する。

```text
DA1b全面実装を行っていないこと
profile永続化を行っていないこと
scheduler全面改修を行っていないこと
saveまたはapprovalを変更していないこと
git add、commit、pushを実行していないこと
```

実装中にcanonical architectureでは決まっていない重大な選択が必要になった場合は、独断で進めず、選択肢、影響、推奨案を報告して停止すること。
