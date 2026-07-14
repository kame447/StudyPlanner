# weeklyPlanning 行動文脈・仮説駆動計画 architecture amendment

Status: ready
Priority: highest
Scope: docs-only architecture design
Production code change: prohibited
Test code change: prohibited

## 1. 目的

現在の週間計画architectureは、自然文をtyped candidateへ変換し、deterministic coreで状態更新、scheduler、preview、approvalを行う安全境界を定義している。

一方で、次の設計が不足している。

```text
生活イベントを単なるbusy intervalではなく、行動の区切りとして扱う設計

暗記、演習、読解、重い課題などの実行特性を表す設計

現在の情報からアプリ側が計画仮説を組み立てる設計

不足項目を一つずつ質問するのではなく、候補を先に提案する設計

十分に具体化される前にpreviewを生成しないreadiness gate

ユーザーが仮予定作成を求めたかどうかを表す明示的な状態
```

本タスクでは、これらを既存のv4 architectureへ統合する。

新しい別系統のcanonical architectureは作らない。既存の設計の正を更新し、roadmap、product spec、roleplay test plan、Requirement ID matrixを同期する。

## 2. 背景となる対話例

次の対話は設計判断のためのcanonical demonstrationとして扱う。ただし、自然文のgolden textや特定語句をproduction contractにしない。

```text
生徒:
英語やらないといけないんだよね

教師:
今週の予定の話で合ってる？
テストや宿題が出ている感じ？

生徒:
金曜日に英単語の小テストがあって、
ワークも10ページくらい出ている

教師:
金曜日にテストなら、木曜日までを目安に進めたい。
英単語は一度にまとめず、今日から少しずつ分けたい。
ワークは今日3ページ、明日と明後日で残りを進める案が考えられる。
1ページにどのくらいかかりそう？

生徒:
10分から15分くらい

教師:
余裕を含めるなら3から4ページで最大90分程度を見ておけそう。
今日はこのあと予定がある？
夕食、帰宅、就寝なども確認する。

生徒:
夕食は19時、朝は続かない。
帰宅後と寝る前なら英単語をできそう。

教師:
夕食前に短い英単語、夕食後にワーク、
寝る前に英単語の復習という案を組み立てる。

生徒:
それじゃあ仮で予定を組んでみよう

教師:
ここで初めてpreviewを生成する。
```

この例で重要なのは、次の点である。

以下は同一レベルの設計上の観察である。

* 最初の「英語やらないと」だけではpreviewを生成しない。
* 教師は全項目を順番に質問していない。
* 現在分かっている情報から、次の候補を先に組み立てている。
* ユーザーには候補との差分だけを答えてもらっている。
* 金曜日のテスト、夕食、帰宅、就寝を、単なる使用不可時間ではなく計画上のアンカーとして扱っている。
* 英単語とワークを、同じ英語という教科でも異なる実行特性として扱っている。
* previewは、十分な情報と仮予定作成への同意が揃ってから生成している。

## 3. 現行architectureの問題

### 3.1 LifeConstraintが時間占有だけに寄っている

現行のLifeConstraintは、sleep、meal、bath、commute、fixed eventなどのkindと、開始・終了・hardnessを持つ。

schedulerでは、これらを主にbusy intervalへ変換して利用している。

この構造では、次の意味を表現できない。

```text
夕食前は短い課題を始めやすい

夕食後はまとまった作業を開始しやすい

学校から帰った直後は休憩や着替えが必要になる

就寝前には重い課題より短い復習が適する

風呂や寝る準備の前後には移行時間がある

本人が朝学習を続けられない

同じ空き時間でも行動開始のしやすさが異なる
```

生活情報をbusyかfreeかだけで表現する設計では、自然な質問や提案を組み立てられない。

### 3.2 タスクが量と所要時間だけに寄っている

現行のStudyTaskScopeはtitle、subject、unit、amount、時間見積もり要否を中心に持つ。

この構造では、次の差を十分に表現できない。

```text
英単語は短時間の反復に向く

ワークはある程度まとまった連続時間を必要とする

提出物は締切前に完了する必要がある

暗記は一度にまとめるより間隔を空ける価値がある

重い問題演習は疲労の高い時間帯を避けたい

初回だけ短い試行枠を置き、その結果から再見積もりしたい
```

### 3.3 assumption proposalとpreviewの間にreadiness gateがない

DA0aはAI draftを安全なpending proposalへ変換できる。

しかし、pending proposalが存在することと、previewを生成してよいことは同じではない。

次の状態を区別する必要がある。

```text
内部で候補を検討できる状態

ユーザーへ条件案を提示できる状態

仮予定作成を提案できる状態

ユーザーが仮予定作成を許可した状態

previewを生成できる状態

previewを保存できる状態
```

### 3.4 missing slot中心では教師的な対話にならない

missing slotを順に質問するだけでは、ユーザーが毎回答えをゼロから考える必要がある。

必要なのは次の流れである。

```text
現在の情報から計画仮説を組み立てる

不足している情報が予定へ与える影響を評価する

安全な候補がある場合は先に提案する

候補との差分だけをユーザーへ尋ねる

安全な候補がない場合だけ質問する
```

## 4. 文書更新対象

次の文書を更新する。

以下の文書は、それぞれ異なる責務を持つ並列の更新対象である。

```text
docs/architecture/weekly-planning-dialogue-architecture-v4.md
docs/weekly-planning/weekly-planning-spec.md
docs/ai/strategy/weekly-planning-roadmap.md
docs/testing/weekly-planning-roleplay-test-plan.md
```

`weekly-planning-dialogue-architecture-v4.md`を引き続き設計の正とする。

新しいarchitectureファイルをcanonical sourceとして追加しない。

historical architectureは変更しない。

## 5. architectureへ追加する概念

型名はarchitecture contractとして明示する。実装時に既存型との統合が必要な場合でも、責務と不変条件を失わないこと。

### 5.1 事実、導出、仮説、仮定の分離

次の区別をarchitectureへ追加する。

```ts
type PlanningFactOrigin =
  | "user_explicit"
  | "deterministic_derived"
  | "accepted_assumption"
  | "profile_memory";

type PlanningFactScope =
  | "current_turn"
  | "current_plan"
  | "current_week"
  | "recurring_profile";

type PlanningConfidence =
  | "high"
  | "medium"
  | "low";
```

`temporary hypothesis`はaccepted factではないため、PlanningFactOriginへ含めない。

次を別の証跡として扱う。

```text
user explicit fact

deterministically derived fact

internal planning hypothesis

pending assumption proposal

accepted assumption fact

recurring profile memory
```

internal planning hypothesisをacceptedFacts、constraints、repositoryへ直接書き込まない。

### 5.2 LifeActivityAnchor

生活イベントを、時刻占有とは別に行動上のアンカーとして参照できるようにする。

```ts
type LifeActivityKind =
  | "school"
  | "work"
  | "commute"
  | "meal"
  | "bath"
  | "sleep"
  | "rest"
  | "preparation"
  | "fixed_event";

type LifeActivityAnchor = {
  anchorId: string;
  kind: LifeActivityKind;
  date?: string;
  startTime?: string;
  endTime?: string;
  sourceFactRefs: string[];
  origin: PlanningFactOrigin;
  scope: PlanningFactScope;
  confidence: PlanningConfidence;
};
```

LifeActivityAnchorはbusy intervalの代替ではない。

hard constraint、soft constraint、buffer、existing plan、timetableから作られる既存availabilityを維持する。

LifeActivityAnchorは、既存availability rangeに行動上の意味を付与するための参照である。

### 5.3 PlanningOpportunityAnnotation

第三のavailability概念を新設しない。

既存のavailable rangeに対するannotationとして、行動上の意味とタスク適合度を持つ。

```ts
type PlanningOpportunityTag =
  | "before_meal"
  | "after_meal"
  | "after_school"
  | "after_work"
  | "after_commute"
  | "before_sleep"
  | "after_rest"
  | "long_contiguous_window"
  | "short_transition_window"
  | "low_activation"
  | "high_continuity";

type StudyActivityKind =
  | "memorization"
  | "drill"
  | "reading"
  | "writing"
  | "problem_solving"
  | "project"
  | "review"
  | "unknown";

type OpportunitySuitability = 0 | 1 | 2 | 3;

type PlanningOpportunityAnnotation = {
  availabilityRangeRef: string;
  anchorRefs: string[];
  tags: PlanningOpportunityTag[];
  suitabilityByActivity: Partial<
    Record<StudyActivityKind, OpportunitySuitability>
  >;
  sourceFactRefs: string[];
};
```

annotationは利用可能時間を新しく作らない。

annotationはhard busy intervalを短縮、拡張、上書きしない。

移動や準備時間によってavailability自体を変更する場合は、既存のconstraintまたはbuffer処理を通す。

annotationは候補枠の順位付け、対話上の説明、配置理由にだけ利用する。

### 5.4 TaskExecutionProfile

学習タスクの実行特性をStudyTaskScopeとは別の計画用profileとして表現する。

```ts
type TaskDistributionPolicy =
  | "single_block"
  | "contiguous"
  | "splittable"
  | "spaced"
  | "sequential_units";

type CognitiveLoad =
  | "light"
  | "medium"
  | "heavy"
  | "unknown";

type TaskExecutionProfile = {
  taskRef: string;
  activityKind: StudyActivityKind;
  distributionPolicy: TaskDistributionPolicy;
  cognitiveLoad: CognitiveLoad;
  minSessionMinutes?: number;
  targetSessionMinutes?: number;
  maxSessionMinutes?: number;
  repetitionsPerDay?: number;
  minimumSpacingMinutes?: number;
  hardDeadline?: string;
  preferredCompletionBy?: string;
  sourceFactRefs: string[];
  confidence: PlanningConfidence;
  origin:
    | "user_explicit"
    | "deterministic_derived"
    | "pending_proposal"
    | "accepted_assumption";
};
```

`hardDeadline`と`preferredCompletionBy`を混同しない。

金曜日のテストがある場合、テスト開始前がhard deadlineになり得る。

木曜日までに完了するという安全余裕は、ユーザーが明示していなければpreferredCompletionByの提案であり、accepted factとして扱わない。

memorizationだから必ず1日2回、workbookだから必ず90分などの固定値を直接埋め込まない。

有限policy registry、public source fact、またはユーザーの過去実績から候補を作り、必要に応じてpending proposalとして扱う。

### 5.5 DraftGenerationIntent

計画について会話していることと、preview生成を求めていることを分離する。

```ts
type DraftGenerationIntent =
  | "not_requested"
  | "assistant_suggested"
  | "user_authorized";
```

次を区別する。

```text
「英語やらないといけない」
  → not_requestedまたはexploration

「今週の予定を作りたい」
  → user_authorizedになり得る

「それじゃあ仮で予定を組んでみよう」
  → user_authorized

アプリが「この条件で仮予定を作りますか」と提案した段階
  → assistant_suggested

その提案にユーザーが同意した段階
  → user_authorized
```

`assistant_suggested`だけでpreviewを生成しない。

AI dialogue plannerがDraftGenerationIntentを直接更新しない。

interpreter candidate、validator、deterministic transitionを通して更新する。

### 5.6 PlanningDimensionとreadiness

単純なmissing数ではなく、hard required dimensionとcounted dimensionを分ける。

```ts
type PlanningDimension =
  | "planning_intent"
  | "planning_range"
  | "task_identity"
  | "goal_scope"
  | "workload"
  | "deadline"
  | "task_execution_profile"
  | "availability_basis"
  | "routine_anchors";

type PlanningReadinessStage =
  | "exploration"
  | "hypothesis_ready"
  | "proposal_ready"
  | "preview_ready";

type PlanningReadinessPolicy = {
  hardRequiredDimensions: PlanningDimension[];
  countedDimensions: PlanningDimension[];
  minimumResolvedCount: number;
  previewRequiredDimensions: PlanningDimension[];
};

type PlanningReadinessSnapshot = {
  stage: PlanningReadinessStage;
  resolvedDimensions: PlanningDimension[];
  unresolvedDimensions: PlanningDimension[];
  blockingDimensions: PlanningDimension[];
  resolvedCount: number;
  policyId: string;
  draftGenerationIntent: DraftGenerationIntent;
  allowedAssumptionSlots: PlanningAssumptionSlot[];
  stateRevision: number;
};
```

readiness policyは有限registryで管理する。

examとnon-examで別policyを持ってよい。

magic numberを複数箇所へ直書きしない。

`resolvedCount`だけでpreview_readyにしない。

次の条件をすべて満たした場合だけpreview_readyになれる。

```text
hard required dimensionがすべてresolved

各work itemに配置可能なexecution shapeがある

availability basisがある

高影響のblocking uncertaintyが残っていない

DraftGenerationIntent=user_authorized

現在state revisionと一致している
```

availability basisは、明示的な空き時間、既存予定と生活制約、確認済みprofile、または表示可能なpending assumptionから構成できる。

routine anchorが存在しないこと自体を常にblock条件にしない。ユーザーが明示的な利用可能時間を指定した場合は、それをavailability basisとしてよい。

### 5.7 MissingResolutionMode

不足情報の解決方法を有限分類する。

```ts
type MissingResolutionMode =
  | "derive_deterministically"
  | "propose_default"
  | "offer_options"
  | "must_confirm";

type ResolutionImpact =
  | "low"
  | "medium"
  | "high";

type MissingResolutionOpportunity = {
  topicId: string;
  dimension: PlanningDimension;
  mode: MissingResolutionMode;
  impact: ResolutionImpact;
  uncertainty: PlanningConfidence;
  proposalSlot?: PlanningAssumptionSlot;
  allowedOptionIds: string[];
  sourceFactRefs: string[];
};
```

分類の基本方針は次とする。

| 不足内容                        | 基本mode                          |
| --------------------------- | ------------------------------- |
| 相対日付の一意解決                   | derive_deterministically        |
| 1回の目安時間                     | propose_default                 |
| 進める量の現実的な候補                 | propose_defaultまたはoffer_options |
| 朝・夕方・夜の候補                   | offer_options                   |
| 何の試験か                       | must_confirm                    |
| 何を学習するのか                    | must_confirmまたはoffer_options    |
| ユーザーの目的そのもの                 | must_confirm                    |
| hard deadline               | must_confirmまたは明示factからderive   |
| preferred completion buffer | propose_default                 |

安全な提案候補がある場合、自由回答だけの質問より提案を優先する。

ユーザーには、候補を承認するか差分だけ修正できる応答を提示する。

次の場合だけ、候補を埋めずに質問する。

```text
目的そのものを決める必要がある

候補間で予定結果が大きく変わる

間違えた場合に締切や利用可能時間へ大きな影響がある

安全な候補を作る根拠がない

既存factやprofileと矛盾している
```

### 5.8 PlanningHypothesisSnapshot

accepted stateから、previewより前の内部計画仮説を生成する。

```ts
type PlanningHypothesisSnapshot = {
  conversationId: string;
  stateRevision: number;
  taskProfiles: TaskExecutionProfile[];
  lifeActivityAnchors: LifeActivityAnchor[];
  opportunityAnnotations: PlanningOpportunityAnnotation[];
  resolutionOpportunities: MissingResolutionOpportunity[];
  readiness: PlanningReadinessSnapshot;
  suggestedNextAction:
    | "acknowledge"
    | "propose_resolution"
    | "offer_options"
    | "ask_required_fact"
    | "suggest_draft_generation"
    | "generate_preview";
};
```

PlanningHypothesisSnapshotは予定ブロックを持たない。

PlanningHypothesisSnapshotをpreview、draft candidate、saved planとして扱わない。

PlanningHypothesisSnapshotをrepositoryまたはlocalStorageへ永続化しない。

同じcanonical stateとpolicy registryからは同じsnapshotを生成する。

AIはreadiness、suitability score、deadline、availability、suggestedNextActionを計算しない。

deterministic coreがsnapshotとAllowedDialogueActionsを生成し、AI dialogue plannerは許可されたactionから選ぶ。

## 6. 全体処理順

v4の全体フローを次へ更新する。

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

  → PlanningHypothesisSnapshot
      readiness
      missing resolution opportunities
      suggested next action

  → AllowedDialogueActions
  → AI dialogue planner
  → response validator
  → deterministic renderer

  → DraftGenerationIntent=user_authorized
     かつ readiness=preview_ready の場合のみ

  → scheduler / feasibility / preview
  → UI上の仮予定
  → explicit assumption decision / correction
  → latest eligible preview
  → explicit UI approval
  → save
```

`hypothesis_ready`、`proposal_ready`ではpreviewを生成しない。

pending proposalが存在するだけではpreviewを生成しない。

preview生成を提案することと、previewを実際に生成することを分ける。

## 7. preview gateの不変条件

次をarchitecture上のstrict invariantとする。

```ts
const previewAllowed =
  readiness.stage === "preview_ready"
  && readiness.draftGenerationIntent === "user_authorized"
  && readiness.blockingDimensions.length === 0
  && readiness.stateRevision === currentStateRevision;
```

実際の実装は上記の式へ直接固定しなくてもよいが、意味的に同じ条件を保証する。

次を禁止する。

```text
漠然としたgoalだけでpreview生成

pending proposalが一件作られたことを理由にpreview生成

optional fieldの件数だけでpreview_ready

assistant_suggestedの段階でpreview生成

高影響の未確認事項を任意値で埋めてpreview生成

AIがreadiness=trueを自己申告

AIがDraftGenerationIntent=user_authorizedを自己申告

生活アンカーannotationがhard busy intervalを上書き

planning hypothesisをaccepted factとして保存
```

## 8. 提案主導の対話方針

対話の基本方針を、slot filling中心からhypothesis-and-revision中心へ変更する。

```text
不足を列挙して質問する

ではなく

現在のfactから仮説を作る
→ 予定への影響が大きい不確実性を探す
→ 安全な候補を先に提示する
→ ユーザーに承認または差分修正を求める
→ 仮説を更新する
```

一turnで提示するproposalまたはquestionは原則1から2件、多くても3件とする。

複数の不足を一度に列挙しない。

ユーザーが「分からない」と答えた場合は、同じ質問を繰り返さず、propose_default、offer_options、first trialのいずれかへ移る。

内部slot名、reasonCode、readiness score、suitability scoreをユーザーへ表示しない。

## 9. profile memoryとsession-local状態

今回のarchitecture amendmentでは、永続profileの保存方式を確定しない。

初期実装では次をsession-localとする。

```text
PlanningHypothesisSnapshot

未承認のLifeActivityAnchor

pending TaskExecutionProfile proposal

MissingResolutionOpportunity

DraftGenerationIntent

pending assumption proposal
```

recurring profileへ昇格する場合は、別taskで次を設計する。

```text
ユーザーの明示同意

source

confidence

lastConfirmedAt

scope

保持期間

削除方法

矛盾時の優先規則
```

「朝は続かない」「夕食はだいたい19時」などを、一度の発話だけで無期限profileへ保存しない。

## 10. current queueの更新

GitHub上のmainを確認し、DA0aが実装・検証・merge済みであることを確認した場合は、architectureとroadmapでDA0aをcompleteへ更新する。

Gate P4のstatusもmainの実態と一致させる。

次のimplementation foundationをDA0より前に追加する。

```text
DA0r behavior-aware planning readiness foundation
```

DA0rの責務は次とする。

```text
PlanningDimension

PlanningReadinessPolicy

PlanningReadinessSnapshot

DraftGenerationIntent

MissingResolutionMode

LifeActivityAnchor

TaskExecutionProfile

PlanningOpportunityAnnotation

PlanningHypothesisSnapshot

preview gate

proposal-first next action policy
```

DA0rは次を扱わない。

```text
preview block生成

scheduler全面改修

AI response rendering

assumption accept/reject/modify

save

approval

profile永続化

UI/CSS
```

DA0 non-exam preview bridgeはDA0rへ依存させる。

DA1はPlanningHypothesisSnapshotとAllowedDialogueActionsを入力に含める。

DA1bは既存のassumption lifecycle責務を維持する。

実装時にDA0r、DA0、DA1、DA1bを一つの大きなvertical-slice taskとして実行することは許容できるが、architecture上の責務、module boundary、test boundaryは分離して記述する。

## 11. Requirement ID

canonical Requirement ID matrixへ次の3件を追加する。

```text
DA-READINESS-001
DA-BEHAVIOR-001
DA-RESOLUTION-001
```

意味は次とする。

| Requirement ID    | 意味                                                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------- |
| DA-READINESS-001  | hard required dimension、counted dimension、DraftGenerationIntent、blocking uncertaintyに基づきpreview gateをdeterministicに判定する |
| DA-BEHAVIOR-001   | 生活イベントとタスク実行特性から、既存availabilityを変更せず行動上のannotationと配置適合度を導出する                                                           |
| DA-RESOLUTION-001 | 現在の仮説から不足情報を分類し、安全な候補がある場合は質問よりproposalまたはoptionを優先する                                                                   |

Requirement matrixの必須件数を更新する。

同一Requirement IDを複数行へ重複登録しない。

roadmap、architecture、roleplay planのowner、status、task dependencyを同期する。

## 12. roleplay test planの更新

新しいcanonical scenarioを追加する。

scenario IDは次を推奨する。

```text
WP-BEHAVIOR-001
```

scenarioには、少なくとも次のstate transitionを含める。

| turn               | strict contract                                                                        |
| ------------------ | -------------------------------------------------------------------------------------- |
| 漠然とした英語goal        | task candidateまたはexploration state。previewなし。DraftGenerationIntentはuser_authorizedにしない |
| 金曜日の単語テストとワーク10ページ | deadline、workload、task identityを別factとして保持                                             |
| 1ページ10から15分        | workload estimate候補。余裕込み時間はpending proposalまたはderived rangeでありaccepted factへ直書きしない     |
| 夕食19時、帰宅17時30分     | LifeActivityAnchorを生成。busy intervalとannotationを分離                                      |
| 朝は続かない             | current planまたはcurrent week scope。無期限profileへ自動保存しない                                   |
| 寝る前に単語             | memorization profileとbefore_sleep opportunityを関連付ける                                    |
| 仮で予定を組むことへ同意       | DraftGenerationIntent=user_authorized                                                  |
| preview生成          | 初めてpreviewを生成。使用したpending assumptionとsource refsをmetadataへ記録                           |
| preview表示          | reasoning summaryをfact refsとdeterministic phraseから描画。saveなし                            |

自然文の完全一致を要求しない。

strict assertionはstate、readiness、dimension、intent、anchor、profile、annotation、proposal、preview metadataを対象にする。

## 13. property-based test contract

今回のtaskはdocs-onlyであるため、テストコードは変更しない。

ただし、後続implementation taskがproperty-based testとして実装すべき性質をarchitectureとroleplay planへ記載する。

以下は概念上並列のpropertyである。

### 13.1 no premature preview

hard required dimensionのいずれかが欠ける任意stateでは、optional dimensionを追加してもpreview_readyにならない。

### 13.2 authorization gate

readiness条件が揃っていても、DraftGenerationIntentがuser_authorizedでなければpreviewを生成しない。

### 13.3 count alone is insufficient

minimumResolvedCountを満たしていても、blocking dimensionまたは高影響uncertaintyがあればpreview_readyにならない。

### 13.4 order independence

同じcanonical fact集合へ異なるturn順序で到達しても、矛盾がない限り同じPlanningReadinessSnapshotを生成する。

### 13.5 irrelevant fact independence

対象task、planning range、availabilityへ関係しないfactを追加しても、readiness、proposal eligibility、preview gateが変化しない。

### 13.6 deterministic hypothesis

同じcanonical state、policy registry、revisionからは同じPlanningHypothesisSnapshotを生成する。

### 13.7 proposal-first resolution

mode=propose_defaultまたはoffer_optionsのopportunityが存在する場合、自由回答だけのquestionを唯一のactionとして返さない。

### 13.8 hard constraint preservation

PlanningOpportunityAnnotationとTaskExecutionProfileによる順位付けは、hard busy interval、existing plan、timetableとの重複を発生させない。

### 13.9 no availability fabrication

annotationを追加しても、available minutesの総量を増加させない。

### 13.10 scope isolation

current weekの習慣factをrecurring profileへ自動昇格しない。

### 13.11 mutation prohibition

readiness evaluator、behavior derivation、hypothesis builderは入力state、facts、constraints、proposalsを変更しない。

### 13.12 conflict handling

矛盾する生活factやtask profileが存在する場合、入力順によって任意の一方を採用せず、blockingまたはclarificationへ移る。

特定の「英語やらないと」という発話だけをno-preview回帰テストとして大量に追加しない。

発話例は少数のscenario testとし、中心は内部stateのpropertyで保証する。

## 14. product specの更新

product specの目的は変更しない。

次を明文化する。

```text
アプリは不足項目を順番に尋ねるだけではない

現在のfactから安全な計画仮説を作る

安全な候補がある場合は候補を先に提示する

生活イベントは行動アンカーとしても扱う

タスク種類に応じて実行形態を変える

仮予定はreadinessとユーザー許可が揃ってから生成する

仮説、仮定、仮予定、確定予定を区別する
```

既存の「質問するべき度 = 影響 × 不確実性 - 質問コスト」は維持する。

これをMissingResolutionModeとMissingResolutionOpportunityへ接続する。

## 15. 非目標

本taskでは次を行わない。

以下は同一レベルの非目標である。

* production codeの変更
* test codeの変更
* schedulerの実装変更
* LifeConstraint migration
* UIまたはCSS変更
* profileの永続化
* user memoryの保存
* AI promptの変更
* DA0 preview bridge実装
* DA1 response contract実装
* DA1b lifecycle実装
* repository save
* approval idempotency
* git add、commit、push、merge

## 16. 整合性確認

更新後に次を確認する。

```text
architecture v4が唯一のcanonical designである

product specとarchitectureの用語が矛盾していない

roadmap current queueとarchitecture current queueが一致している

DA0aのstatusがmainの実態と一致している

DA0rがDA0より前に配置されている

Requirement ID matrixに欠落、重複、owner不一致がない

WP-BEHAVIOR-001が新Requirement IDをtraceできる

historical roadmapをcurrent queueへ戻していない

第三のavailability概念を新設していない

pending proposalだけでpreview可能になる記述が残っていない

preview生成とsave approvalを混同していない
```

## 17. 検証

docs-only変更として次を実行する。

```bash
git diff --check
git status -sb
```

repositoryにmarkdown lintまたはdocs link checkが存在する場合は実行する。

production testとbuildは、production codeを変更していないため原則不要である。

ただし、repository規約がdocs-onlyでもfull testを要求する場合は従う。

## 18. 最終報告

最終報告には次を含める。

以下は並列の報告項目である。

* 変更した文書
* 追加したarchitecture概念
* preview readiness gateの最終条件
* proposal-first policyの最終分類
* LifeActivityAnchorと既存LifeConstraintの責務境界
* PlanningOpportunityAnnotationと既存availabilityの責務境界
* TaskExecutionProfileとStudyTaskScopeの責務境界
* 新規Requirement ID
* roleplayへ追加したscenarioとproperty contract
* roadmapの新しいcurrent queue
* DA0a statusの更新結果
* docs間の矛盾確認結果
* `git diff --check`結果
* production codeとtest codeを変更していないこと
* Git操作を実行していないこと

曖昧な点を独断で実装へ落とさない。

architecture上で未決定の項目が残る場合は、選択肢、影響、推奨案を文書へ明記する。
